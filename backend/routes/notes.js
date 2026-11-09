const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();
const prisma = new PrismaClient();
const STUDENT_VISIBLE_LESSON_STATUSES = new Set(['PUBLISHED', 'LIVE']);
const normalizeLessonStatus = (value) => String(value || '').trim().toUpperCase();

const authorizeLessonAccess = async ({ lessonId, userId, role }) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      class: {
        select: {
          id: true,
          teacher_id: true,
        },
      },
    },
  });

  if (!lesson) {
    return { lesson: null, allowed: false, notFound: true };
  }

  if (role === 'TEACHER') {
    return {
      lesson,
      allowed: lesson.class.teacher_id === userId,
      notFound: false,
    };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: lesson.class_id,
      user_id: userId,
    },
    select: { id: true },
  });

  return {
    lesson,
    allowed:
      Boolean(enrollment) && STUDENT_VISIBLE_LESSON_STATUSES.has(normalizeLessonStatus(lesson.status)),
    notFound: false,
  };
};

const requireStudent = (req, res) => {
  if (req.user?.role !== 'STUDENT') {
    res.status(403).json({ error: 'Student access required' });
    return false;
  }
  return true;
};

const isValidLessonBlockReference = async ({ lessonId, blockId, studentId }) => {
  if (!lessonId || !blockId || !studentId) {
    return false;
  }

  const [officialBlock, personalBlock] = await Promise.all([
    prisma.lessonBlock.findFirst({
      where: {
        id: blockId,
        lesson_id: lessonId,
      },
      select: { id: true },
    }),
    prisma.studentPersonalBlock.findFirst({
      where: {
        id: blockId,
        lesson_id: lessonId,
        student_id: studentId,
      },
      select: { id: true },
    }),
  ]);

  return Boolean(officialBlock || personalBlock);
};

router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!requireStudent(req, res)) {
      return;
    }

    const lessonId = String(req.query.lessonId || '').trim();
    const blockId = String(req.query.blockId || '').trim();

    if (!lessonId) {
      return res.status(400).json({ error: 'lessonId is required' });
    }

    const auth = await authorizeLessonAccess({
      lessonId,
      userId: req.user.userId,
      role: req.user.role,
    });

    if (auth.notFound) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (!auth.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (blockId) {
      const isValidBlock = await isValidLessonBlockReference({
        lessonId,
        blockId,
        studentId: req.user.userId,
      });
      if (!isValidBlock) {
        return res.status(400).json({ error: 'blockId must reference a block in this lesson' });
      }
    }

    const notes = await prisma.studentNote.findMany({
      where: {
        lesson_id: lessonId,
        user_id: req.user.userId,
        ...(blockId ? { block_id: blockId } : {}),
      },
      orderBy: { created_at: 'asc' },
    });

    return res.json(notes);
  } catch (error) {
    console.error('Failed to list notes:', error);
    return res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!requireStudent(req, res)) {
      return;
    }

    const lessonId = String(req.body?.lessonId || '').trim();
    const blockId = String(req.body?.blockId || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';

    if (!lessonId || !blockId) {
      return res.status(400).json({ error: 'lessonId and blockId are required' });
    }

    const auth = await authorizeLessonAccess({
      lessonId,
      userId: req.user.userId,
      role: req.user.role,
    });

    if (auth.notFound) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    if (!auth.allowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const isValidBlock = await isValidLessonBlockReference({
      lessonId,
      blockId,
      studentId: req.user.userId,
    });
    if (!isValidBlock) {
      return res.status(400).json({ error: 'blockId must reference a block in this lesson' });
    }

    const note = await prisma.studentNote.create({
      data: {
        lesson_id: lessonId,
        block_id: blockId,
        user_id: req.user.userId,
        content,
      },
    });

    return res.status(201).json(note);
  } catch (error) {
    console.error('Failed to create note:', error);
    return res.status(500).json({ error: 'Failed to create note' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!requireStudent(req, res)) {
      return;
    }

    const id = String(req.params.id || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';

    const existing = await prisma.studentNote.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (existing.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const note = await prisma.studentNote.update({
      where: { id },
      data: { content },
    });

    return res.json(note);
  } catch (error) {
    console.error('Failed to update note:', error);
    return res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!requireStudent(req, res)) {
      return;
    }

    const id = String(req.params.id || '').trim();

    const existing = await prisma.studentNote.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Note not found' });
    }

    if (existing.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.studentNote.delete({ where: { id } });
    return res.json({ message: 'Note deleted' });
  } catch (error) {
    console.error('Failed to delete note:', error);
    return res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;
