const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');

const prisma = new PrismaClient();

const authorizeClassAccess = async ({ classId, userId, role }) => {
  const targetClass = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, teacher_id: true, is_archived: true, teacher: { select: { id: true, name: true } } },
  });

  if (!targetClass) {
    return { notFound: true, allowed: false, classRecord: null };
  }

  if (role === 'TEACHER') {
    const allowed = targetClass.teacher_id === userId;
    return { notFound: false, allowed, classRecord: allowed ? targetClass : null };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: classId,
      user_id: userId,
    },
    select: { id: true },
  });

  return { notFound: false, allowed: Boolean(enrollment), classRecord: targetClass };
};

// Get announcements for a class.
router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId, role } = req.user;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const access = await authorizeClassAccess({ classId, userId, role });
    if (access.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const announcements = await prisma.announcement.findMany({
      where: { class_id: classId },
      orderBy: { created_at: 'desc' },
    });

    return res.json(
      announcements.map((announcement) => ({
        ...announcement,
        teacher_name: access.classRecord?.teacher?.name || 'Teacher',
      }))
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// Create announcement (Teacher only, owner only).
router.post('/class/:classId', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId } = req.user;
    const message = String(req.body?.message || '').trim();

    if (!message) {
      return res.status(400).json({ error: 'Announcement message is required' });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: 'Announcement message is too long (max 5000 characters)' });
    }

    const access = await authorizeClassAccess({ classId, userId, role: 'TEACHER' });
    if (access.notFound) {
      return res.status(404).json({ error: 'Class not found' });
    }
    if (!access.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (access.classRecord?.is_archived) {
      return res.status(400).json({ error: 'Cannot create announcements in an archived class' });
    }

    const created = await prisma.announcement.create({
      data: {
        class_id: classId,
        message,
      },
    });

    return res.status(201).json({
      ...created,
      teacher_name: access.classRecord?.teacher?.name || 'Teacher',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// Delete announcement (Teacher only, owner only).
router.delete('/:id', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const target = await prisma.announcement.findUnique({
      where: { id },
      include: {
        class: {
          select: { teacher_id: true },
        },
      },
    });

    if (!target) {
      return res.status(404).json({ error: 'Announcement not found' });
    }
    if (target.class.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.announcement.delete({
      where: { id },
    });

    return res.json({ message: 'Announcement deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
