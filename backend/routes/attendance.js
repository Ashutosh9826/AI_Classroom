const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');
const { getOnlineStudentIdsForClass } = require('../services/presenceStore');

const prisma = new PrismaClient();

const ATTENDANCE_STATUS = new Set(['PRESENT', 'ABSENT']);

const parseDateInput = (rawDate) => {
  const value =
    typeof rawDate === 'string' && rawDate.trim()
      ? rawDate.trim()
      : new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { dateKey: value, start, end };
};

const ensureTeacherClassOwnership = async (classId, teacherId) => {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
  });

  if (!cls) {
    return { notFound: true, forbidden: false, classRecord: null };
  }
  if (cls.teacher_id !== teacherId) {
    return { notFound: false, forbidden: true, classRecord: null };
  }
  return { notFound: false, forbidden: false, classRecord: cls };
};

const buildDaySnapshot = async ({ classId, start, end }) => {
  const [enrollments, records] = await Promise.all([
    prisma.enrollment.findMany({
      where: { class_id: classId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        class_id: classId,
        attendance_date: {
          gte: start,
          lt: end,
        },
      },
      orderBy: { updated_at: 'desc' },
    }),
  ]);

  const recordByStudentId = new Map(records.map((record) => [record.student_id, record]));
  const onlineStudentSet = new Set(await getOnlineStudentIdsForClass(classId));

  const students = enrollments.map((enrollment) => {
    const record = recordByStudentId.get(enrollment.user_id);
    return {
      id: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      status: record?.status || 'ABSENT',
      mode: record?.mode || null,
      record_id: record?.id || null,
      updated_at: record?.updated_at || null,
      online_now: onlineStudentSet.has(enrollment.user_id),
    };
  });

  const presentCount = students.filter((student) => student.status === 'PRESENT').length;
  const absentCount = students.length - presentCount;

  return {
    students,
    summary: {
      total: students.length,
      present: presentCount,
      absent: absentCount,
      attendance_rate: students.length ? Math.round((presentCount / students.length) * 100) : 0,
    },
    onlineStudentIds: [...onlineStudentSet],
  };
};

// Teacher view: attendance for one class on one day (with roster + online markers).
router.get('/class/:classId/day', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId } = req.user;
    const parsedDate = parseDateInput(req.query.date);

    if (!parsedDate) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const ownership = await ensureTeacherClassOwnership(classId, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const snapshot = await buildDaySnapshot({
      classId,
      start: parsedDate.start,
      end: parsedDate.end,
    });

    return res.json({
      class_id: classId,
      date: parsedDate.dateKey,
      ...snapshot,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Teacher action: manual attendance update.
router.post('/class/:classId/day/manual', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId } = req.user;
    const { date, records } = req.body;
    const parsedDate = parseDateInput(date);

    if (!parsedDate) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records must be a non-empty array' });
    }

    const ownership = await ensureTeacherClassOwnership(classId, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { class_id: classId },
      select: { user_id: true },
    });
    const allowedStudentIds = new Set(enrollments.map((enrollment) => enrollment.user_id));

    const recordMap = new Map();
    for (const rawRecord of records) {
      const normalizedRecord = {
        student_id: String(rawRecord?.student_id || ''),
        status: String(rawRecord?.status || '').toUpperCase(),
      };

      if (!normalizedRecord.student_id || !allowedStudentIds.has(normalizedRecord.student_id)) {
        return res.status(400).json({ error: 'One or more student IDs are invalid for this class' });
      }
      if (!ATTENDANCE_STATUS.has(normalizedRecord.status)) {
        return res.status(400).json({ error: 'Status must be PRESENT or ABSENT' });
      }

      // Keep only one final status per student to avoid duplicate upserts in a single request.
      recordMap.set(normalizedRecord.student_id, normalizedRecord);
    }

    const normalizedRecords = [...recordMap.values()];
    if (normalizedRecords.length === 0) {
      return res.status(400).json({ error: 'No valid records provided' });
    }

    await prisma.$transaction(
      normalizedRecords.map((record) =>
        prisma.attendanceRecord.upsert({
          where: {
            class_id_student_id_attendance_date: {
              class_id: classId,
              student_id: record.student_id,
              attendance_date: parsedDate.start,
            },
          },
          update: {
            status: record.status,
            mode: 'MANUAL',
            marked_by: userId,
          },
          create: {
            class_id: classId,
            student_id: record.student_id,
            attendance_date: parsedDate.start,
            status: record.status,
            mode: 'MANUAL',
            marked_by: userId,
          },
        })
      )
    );

    const snapshot = await buildDaySnapshot({
      classId,
      start: parsedDate.start,
      end: parsedDate.end,
    });

    return res.json({
      class_id: classId,
      date: parsedDate.dateKey,
      mode: 'MANUAL',
      ...snapshot,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save manual attendance' });
  }
});

// Teacher action: automatic attendance (online students => present, others => absent).
router.post('/class/:classId/day/automatic', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId } = req.user;
    const { date } = req.body;
    const parsedDate = parseDateInput(date);

    if (!parsedDate) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const ownership = await ensureTeacherClassOwnership(classId, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { class_id: classId },
      select: { user_id: true },
    });
    const onlineStudentSet = new Set(await getOnlineStudentIdsForClass(classId));

    await prisma.$transaction(
      enrollments.map((enrollment) =>
        prisma.attendanceRecord.upsert({
          where: {
            class_id_student_id_attendance_date: {
              class_id: classId,
              student_id: enrollment.user_id,
              attendance_date: parsedDate.start,
            },
          },
          update: {
            status: onlineStudentSet.has(enrollment.user_id) ? 'PRESENT' : 'ABSENT',
            mode: 'AUTO',
            marked_by: userId,
          },
          create: {
            class_id: classId,
            student_id: enrollment.user_id,
            attendance_date: parsedDate.start,
            status: onlineStudentSet.has(enrollment.user_id) ? 'PRESENT' : 'ABSENT',
            mode: 'AUTO',
            marked_by: userId,
          },
        })
      )
    );

    const snapshot = await buildDaySnapshot({
      classId,
      start: parsedDate.start,
      end: parsedDate.end,
    });

    return res.json({
      class_id: classId,
      date: parsedDate.dateKey,
      mode: 'AUTO',
      ...snapshot,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to run automatic attendance' });
  }
});

// Student view: own attendance only.
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const classId = String(req.query.classId || '').trim();

    if (role === 'TEACHER') {
      return res.status(403).json({ error: 'Teachers cannot use student attendance view' });
    }
    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        class_id: classId,
        user_id: userId,
      },
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        class_id: classId,
        student_id: userId,
      },
      orderBy: { attendance_date: 'desc' },
      take: 120,
    });

    const transformed = records.map((record) => ({
      id: record.id,
      date: record.attendance_date.toISOString().slice(0, 10),
      status: record.status,
      mode: record.mode,
      updated_at: record.updated_at,
    }));

    const presentCount = transformed.filter((record) => record.status === 'PRESENT').length;
    const absentCount = transformed.filter((record) => record.status === 'ABSENT').length;
    const total = transformed.length;

    return res.json({
      class_id: classId,
      records: transformed,
      summary: {
        total,
        present: presentCount,
        absent: absentCount,
        attendance_rate: total ? Math.round((presentCount / total) * 100) : 0,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch your attendance' });
  }
});

module.exports = router;
