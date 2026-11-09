const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');

const prisma = new PrismaClient();

// Get assignments for a class
router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { userId, role } = req.user;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const targetClass = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, teacher_id: true },
    });

    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (role === 'TEACHER') {
      if (targetClass.teacher_id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else {
      const enrollment = await prisma.enrollment.findFirst({
        where: {
          class_id: classId,
          user_id: userId,
        },
      });

      if (!enrollment) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const assignments = await prisma.assignment.findMany({
      where: { class_id: classId },
      orderBy: { due_date: 'asc' },
    });

    if (role === 'STUDENT') {
      const assignmentIds = assignments.map((assignment) => assignment.id);
      const submissions = assignmentIds.length
        ? await prisma.submission.findMany({
            where: {
              assignment_id: { in: assignmentIds },
              student_id: userId,
            },
            select: { assignment_id: true },
          })
        : [];

      const submittedAssignmentIds = new Set(submissions.map((submission) => submission.assignment_id));
      const studentAssignments = assignments.map((assignment) => ({
        ...assignment,
        completed: submittedAssignmentIds.has(assignment.id),
      }));

      return res.json(studentAssignments);
    }

    res.json(assignments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get single assignment details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user || {};

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    const include = {
      class: {
        select: { id: true, name: true, teacher_id: true },
      },
    };

    if (role === 'STUDENT') {
      include.submissions = {
        where: { student_id: userId },
      };
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include,
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    if (role === 'TEACHER') {
      if (assignment.class.teacher_id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      return res.json({
        ...assignment,
        class: { name: assignment.class.name, id: assignment.class.id },
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        class_id: assignment.class.id,
        user_id: userId,
      },
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      ...assignment,
      class: { name: assignment.class.name, id: assignment.class.id },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

// Create assignment (Teacher only)
router.post('/', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { class_id, title, description, due_date, attachment_url } = req.body;
    const { userId } = req.user;

    const targetClass = await prisma.class.findUnique({
      where: { id: class_id },
    });

    if (!targetClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (targetClass.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (targetClass.is_archived) {
      return res.status(400).json({ error: 'Cannot create assignments in an archived class' });
    }

    const newAssignment = await prisma.assignment.create({
      data: {
        class_id,
        title,
        description,
        due_date: due_date ? new Date(due_date) : null,
        attachment_url
      }
    });

    res.status(201).json(newAssignment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

// Student Submit Assignment
router.post('/:id/submit', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { file_url } = req.body;
    const { userId, role } = req.user;

    if (!userId) {
      return res.status(401).json({ error: 'Invalid session. Please sign in again.' });
    }

    if (role === 'TEACHER') {
      return res.status(403).json({ error: 'Teachers cannot submit assignments' });
    }

    if (typeof file_url !== 'string' || !file_url.trim()) {
      return res.status(400).json({ error: 'Submission content is required' });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        class: true,
      },
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        class_id: assignment.class_id,
        user_id: userId,
      },
    });

    if (!enrollment) {
      return res.status(403).json({ error: 'You are not enrolled in this class' });
    }

    const submission = await prisma.submission.create({
      data: {
        assignment_id: id,
        student_id: userId,
        file_url: file_url.trim(),
      }
    });

    res.status(201).json(submission);
  } catch (err) {
    console.error('Submit assignment error:', err);
    res.status(500).json({ error: 'Failed to submit assignment' });
  }
});

// Teacher Get All Submissions for Assignment
router.get('/:id/submissions', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if teacher owns the class
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { class: true }
    });

    if (!assignment || assignment.class.teacher_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const submissions = await prisma.submission.findMany({
      where: { assignment_id: id },
      include: {
        student: { select: { id: true, name: true, email: true } }
      },
      orderBy: { submitted_at: 'desc' }
    });

    res.json(submissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Teacher Grade Submission
router.put('/submissions/:submissionId/grade', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { grade, feedback } = req.body;
    const { userId } = req.user;

    const submissionRecord = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          include: { class: true },
        },
      },
    });

    if (!submissionRecord) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submissionRecord.assignment.class.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const numericGrade = Number(grade);
    if (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > 100) {
      return res.status(400).json({ error: 'Grade must be a number between 0 and 100' });
    }

    const submission = await prisma.submission.update({
      where: { id: submissionId },
      data: {
        grade: numericGrade,
        feedback: typeof feedback === 'string' ? feedback : null,
      }
    });

    res.json(submission);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to grade submission' });
  }
});

// Delete assignment (Teacher only, owner only)
router.delete('/:id', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: { class: true },
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    if (assignment.class.teacher_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.submission.deleteMany({
        where: { assignment_id: id },
      });

      await tx.assignment.delete({
        where: { id },
      });
    });

    return res.json({ message: 'Assignment deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

module.exports = router;
