const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');
const { getOnlineStudentIdsForClass } = require('../services/presenceStore');

const prisma = new PrismaClient();

const parseArchivedFilter = (rawValue) => {
  const normalized = String(rawValue ?? 'false').toLowerCase();
  if (normalized === 'all') {
    return { includeAll: true, archivedOnly: false };
  }
  if (normalized === 'true') {
    return { includeAll: false, archivedOnly: true };
  }
  return { includeAll: false, archivedOnly: false };
};

const getTeacherOwnedClass = async (classId, teacherId) => {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
  });

  if (!cls) {
    return { notFound: true, classRecord: null };
  }

  if (cls.teacher_id !== teacherId) {
    return { notFound: false, forbidden: true, classRecord: null };
  }

  return { notFound: false, forbidden: false, classRecord: cls };
};

const ensureClassAccess = async ({ classId, userId, role }) => {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
  });

  if (!cls) {
    return { notFound: true, forbidden: false, classRecord: null, isTeacherOwner: false };
  }

  if (role === 'TEACHER') {
    if (cls.teacher_id !== userId) {
      return { notFound: false, forbidden: true, classRecord: null, isTeacherOwner: false };
    }
    return { notFound: false, forbidden: false, classRecord: cls, isTeacherOwner: true };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: classId,
      user_id: userId,
    },
    select: { id: true },
  });

  if (!enrollment) {
    return { notFound: false, forbidden: true, classRecord: null, isTeacherOwner: false };
  }

  return { notFound: false, forbidden: false, classRecord: cls, isTeacherOwner: false };
};

// Get classes for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { userId, role } = req.user;
    const { includeAll, archivedOnly } = parseArchivedFilter(req.query.archived);

    if (role === 'TEACHER') {
      const where = { teacher_id: userId };
      if (!includeAll) {
        where.is_archived = archivedOnly;
      }

      const classes = await prisma.class.findMany({
        where,
        include: { _count: { select: { enrollments: true } } },
        orderBy: [{ name: 'asc' }],
      });
      return res.json(classes);
    }

    const where = {
      enrollments: {
        some: { user_id: userId },
      },
    };

    if (!includeAll) {
      where.is_archived = archivedOnly;
    }

    const classes = await prisma.class.findMany({
      where,
      include: {
        teacher: { select: { name: true } },
      },
      orderBy: [{ name: 'asc' }],
    });

    return res.json(classes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// Get class details by id (for class stream + archived state)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    const cls = await prisma.class.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    });

    if (!cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (role === 'TEACHER') {
      if (cls.teacher_id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return res.json(cls);
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        user_id: userId,
        class_id: id,
      },
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(cls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch class' });
  }
});

// List enrolled students for a class.
router.get('/:id/students', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;

    const access = await ensureClassAccess({ classId: id, userId, role });
    if (access.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (access.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [enrollments, onlineStudentIds] = await Promise.all([
      prisma.enrollment.findMany({
        where: { class_id: id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar_url: true,
              created_at: true,
            },
          },
        },
        orderBy: {
          user: { name: 'asc' },
        },
      }),
      getOnlineStudentIdsForClass(id),
    ]);

    const onlineSet = new Set(onlineStudentIds || []);
    const students = enrollments.map((enrollment) => ({
      id: enrollment.user.id,
      name: enrollment.user.name,
      email: enrollment.user.email,
      avatar_url: enrollment.user.avatar_url,
      account_created_at: enrollment.user.created_at,
      online_now: onlineSet.has(enrollment.user.id),
    }));

    return res.json({
      class_id: id,
      students,
      summary: {
        total: students.length,
        online: students.filter((student) => student.online_now).length,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Detailed student profile for a class.
router.get('/:id/students/:studentId', authenticateToken, async (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { userId, role } = req.user;

    const access = await ensureClassAccess({ classId: id, userId, role });
    if (access.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (access.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetStudentId = String(studentId || '').trim();
    if (!targetStudentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }

    if (role !== 'TEACHER' && userId !== targetStudentId) {
      return res.status(403).json({ error: 'Students can only view their own detailed record' });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        class_id: id,
        user_id: targetStudentId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
            created_at: true,
            role: true,
          },
        },
      },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Student not found in this class' });
    }

    const [
      totalAttendance,
      presentAttendance,
      absentAttendance,
      lastAttendanceRecord,
      recentAttendanceRecords,
      onlineStudentIds,
      studentRecords,
    ] = await Promise.all([
      prisma.attendanceRecord.count({
        where: {
          class_id: id,
          student_id: targetStudentId,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          class_id: id,
          student_id: targetStudentId,
          status: 'PRESENT',
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          class_id: id,
          student_id: targetStudentId,
          status: 'ABSENT',
        },
      }),
      prisma.attendanceRecord.findFirst({
        where: {
          class_id: id,
          student_id: targetStudentId,
        },
        orderBy: [{ attendance_date: 'desc' }, { updated_at: 'desc' }],
      }),
      prisma.attendanceRecord.findMany({
        where: {
          class_id: id,
          student_id: targetStudentId,
        },
        orderBy: [{ attendance_date: 'desc' }, { updated_at: 'desc' }],
        take: 12,
      }),
      getOnlineStudentIdsForClass(id),
      role === 'TEACHER'
        ? prisma.studentRecord.findMany({
          where: {
            class_id: id,
            student_id: targetStudentId,
          },
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: [{ created_at: 'desc' }],
          take: 40,
        })
        : Promise.resolve([]),
    ]);

    const onlineSet = new Set(onlineStudentIds || []);

    return res.json({
      class_id: id,
      student: {
        id: enrollment.user.id,
        name: enrollment.user.name,
        email: enrollment.user.email,
        role: enrollment.user.role,
        avatar_url: enrollment.user.avatar_url,
        account_created_at: enrollment.user.created_at,
        online_now: onlineSet.has(enrollment.user.id),
      },
      attendance_summary: {
        total: totalAttendance,
        present: presentAttendance,
        absent: absentAttendance,
        attendance_rate: totalAttendance ? Math.round((presentAttendance / totalAttendance) * 100) : 0,
        last_marked_at: lastAttendanceRecord?.updated_at || null,
      },
      recent_attendance: recentAttendanceRecords.map((record) => ({
        id: record.id,
        date: record.attendance_date.toISOString().slice(0, 10),
        status: record.status,
        mode: record.mode,
        updated_at: record.updated_at,
      })),
      student_records: studentRecords.map((record) => ({
        id: record.id,
        title: record.title,
        remark: record.remark,
        created_at: record.created_at,
        updated_at: record.updated_at,
        created_by: record.created_by,
        created_by_name: record.creator?.name || 'Teacher',
        created_by_email: record.creator?.email || null,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Add a teacher record/remark for a student in class.
router.post('/:id/students/:studentId/records', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { userId } = req.user;
    const title = String(req.body?.title || '').trim();
    const remark = String(req.body?.remark || '').trim();

    const ownership = await getTeacherOwnedClass(id, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetStudentId = String(studentId || '').trim();
    if (!targetStudentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }
    if (!remark) {
      return res.status(400).json({ error: 'remark is required' });
    }
    if (title.length > 160) {
      return res.status(400).json({ error: 'title must be 160 characters or fewer' });
    }
    if (remark.length > 4000) {
      return res.status(400).json({ error: 'remark must be 4000 characters or fewer' });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        class_id: id,
        user_id: targetStudentId,
      },
      select: { id: true },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Student not found in this class' });
    }

    const created = await prisma.studentRecord.create({
      data: {
        class_id: id,
        student_id: targetStudentId,
        created_by: userId,
        title: title || null,
        remark,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return res.status(201).json({
      id: created.id,
      title: created.title,
      remark: created.remark,
      created_at: created.created_at,
      updated_at: created.updated_at,
      created_by: created.created_by,
      created_by_name: created.creator?.name || 'Teacher',
      created_by_email: created.creator?.email || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create student record' });
  }
});

// Delete a teacher record/remark for a student in class.
router.delete('/:id/students/:studentId/records/:recordId', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id, studentId, recordId } = req.params;
    const { userId } = req.user;

    const ownership = await getTeacherOwnedClass(id, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetStudentId = String(studentId || '').trim();
    const targetRecordId = String(recordId || '').trim();
    if (!targetStudentId || !targetRecordId) {
      return res.status(400).json({ error: 'studentId and recordId are required' });
    }

    const record = await prisma.studentRecord.findFirst({
      where: {
        id: targetRecordId,
        class_id: id,
        student_id: targetStudentId,
      },
      select: { id: true },
    });

    if (!record) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    await prisma.studentRecord.delete({
      where: { id: targetRecordId },
    });

    return res.json({
      message: 'Student record deleted',
      id: targetRecordId,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete student record' });
  }
});

// Create class (Teacher only)
router.post('/', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { name, section } = req.body;
    const { userId } = req.user;

    // Generate random 6-char code
    const class_code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newClass = await prisma.class.create({
      data: {
        name,
        section,
        class_code,
        teacher_id: userId,
      },
    });

    res.status(201).json(newClass);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// Join class by code (Student)
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { class_code } = req.body;
    const { userId, role } = req.user;

    if (role === 'TEACHER') {
      return res.status(403).json({ error: 'Teachers cannot join classes as students' });
    }

    const targetClass = await prisma.class.findUnique({
      where: { class_code },
    });

    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (targetClass.is_archived) {
      return res.status(400).json({ error: 'Cannot join an archived class' });
    }

    const existingEnrollment = await prisma.enrollment.findFirst({
      where: { user_id: userId, class_id: targetClass.id },
    });

    if (existingEnrollment) {
      return res.status(400).json({ error: 'Already enrolled in this class' });
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        user_id: userId,
        class_id: targetClass.id,
      },
    });

    res.status(200).json({ message: 'Successfully joined class', class_id: targetClass.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join class' });
  }
});

// Archive class (Teacher only, owner only)
router.patch('/:id/archive', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const ownership = await getTeacherOwnedClass(id, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await prisma.class.update({
      where: { id },
      data: {
        is_archived: true,
        archived_at: new Date(),
      },
      include: { _count: { select: { enrollments: true } } },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to archive class' });
  }
});

// Unarchive class (Teacher only, owner only)
router.patch('/:id/unarchive', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const ownership = await getTeacherOwnedClass(id, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await prisma.class.update({
      where: { id },
      data: {
        is_archived: false,
        archived_at: null,
      },
      include: { _count: { select: { enrollments: true } } },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to unarchive class' });
  }
});

// Remove a student from a class (Teacher only, owner only).
router.delete('/:id/students/:studentId', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id, studentId } = req.params;
    const { userId } = req.user;

    const ownership = await getTeacherOwnedClass(id, userId);
    if (ownership.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (ownership.forbidden) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetStudentId = String(studentId || '').trim();
    if (!targetStudentId) {
      return res.status(400).json({ error: 'studentId is required' });
    }

    const deleted = await prisma.enrollment.deleteMany({
      where: {
        class_id: id,
        user_id: targetStudentId,
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Student not found in this class' });
    }

    const remainingCount = await prisma.enrollment.count({
      where: { class_id: id },
    });

    return res.json({
      message: 'Student removed from class',
      class_id: id,
      student_id: targetStudentId,
      remaining_students: remainingCount,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to remove student from class' });
  }
});

module.exports = router;
