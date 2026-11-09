const {
  addClassPresence: addClassPresenceDefault,
  removeClassPresence: removeClassPresenceDefault,
  removeSocketPresence: removeSocketPresenceDefault,
  getOnlineStudentIdsForClass: getOnlineStudentIdsForClassDefault,
} = require('../services/presenceStore');
const { getRedisClient: getRedisClientDefault } = require('../services/redisClient');
const { PrismaClient } = require('@prisma/client');

const prismaDefault = new PrismaClient();

function normalizeId(value) {
  return String(value || '').trim();
}

const getQuizRedisKey = (lessonId, blockId) => `quiz:${lessonId}:${blockId}`;
const getQuizMemoryKey = (lessonId, blockId) => `${lessonId}:${blockId}`;

function registerRealtimeHandlers(io, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const addClassPresence = deps.addClassPresence || addClassPresenceDefault;
  const removeClassPresence = deps.removeClassPresence || removeClassPresenceDefault;
  const removeSocketPresence = deps.removeSocketPresence || removeSocketPresenceDefault;
  const getOnlineStudentIdsForClass =
    deps.getOnlineStudentIdsForClass || getOnlineStudentIdsForClassDefault;
  const getRedisClient = deps.getRedisClient || getRedisClientDefault;
  const activeQuizSessions = deps.activeQuizSessions || {};
  const prisma = deps.prisma || prismaDefault;

  const isFinalQuizBlock =
    deps.isFinalQuizBlock ||
    (async ({ lessonId, blockId }) => {
      const safeLessonId = normalizeId(lessonId);
      const safeBlockId = normalizeId(blockId);
      if (!safeLessonId || !safeBlockId) {
        return false;
      }

      try {
        const finalQuiz = await prisma.lessonBlock.findFirst({
          where: {
            lesson_id: safeLessonId,
            type: 'QUIZ',
          },
          orderBy: { order_index: 'desc' },
          select: { id: true },
        });

        return finalQuiz?.id === safeBlockId;
      } catch (error) {
        console.error('Failed to verify final quiz block:', error?.message || error);
        return false;
      }
    });

  const setQuizSession = async ({ lessonId, blockId, timeLimit }) => {
    const safeLessonId = normalizeId(lessonId);
    const safeBlockId = normalizeId(blockId);
    if (!safeLessonId || !safeBlockId) {
      return null;
    }

    const normalizedTimeLimit = Math.max(1, Number(timeLimit) || 30);
    const session = {
      startTime: now(),
      timeLimit: normalizedTimeLimit,
    };

    activeQuizSessions[getQuizMemoryKey(safeLessonId, safeBlockId)] = session;

    try {
      const redisClient = await getRedisClient();
      if (redisClient) {
        await redisClient.set(
          getQuizRedisKey(safeLessonId, safeBlockId),
          JSON.stringify(session),
          {
            EX: Math.max(normalizedTimeLimit + 600, 900),
          }
        );
      }
    } catch (error) {
      console.error('Failed to persist quiz state in Redis:', error?.message || error);
    }

    return session;
  };

  const clearQuizSession = async ({ lessonId, blockId }) => {
    const safeLessonId = normalizeId(lessonId);
    const safeBlockId = normalizeId(blockId);
    if (!safeLessonId || !safeBlockId) {
      return;
    }

    delete activeQuizSessions[getQuizMemoryKey(safeLessonId, safeBlockId)];

    try {
      const redisClient = await getRedisClient();
      if (redisClient) {
        await redisClient.del(getQuizRedisKey(safeLessonId, safeBlockId));
      }
    } catch (error) {
      console.error('Failed to clear quiz state in Redis:', error?.message || error);
    }
  };

  const getQuizSession = async ({ lessonId, blockId }) => {
    const safeLessonId = normalizeId(lessonId);
    const safeBlockId = normalizeId(blockId);
    if (!safeLessonId || !safeBlockId) {
      return null;
    }

    const memorySession = activeQuizSessions[getQuizMemoryKey(safeLessonId, safeBlockId)] || null;

    try {
      const redisClient = await getRedisClient();
      if (!redisClient) {
        return memorySession;
      }

      const serialized = await redisClient.get(getQuizRedisKey(safeLessonId, safeBlockId));
      if (!serialized) {
        return memorySession;
      }

      const parsed = JSON.parse(serialized);
      const startTime = Number(parsed?.startTime);
      const timeLimit = Number(parsed?.timeLimit);
      if (!Number.isFinite(startTime) || !Number.isFinite(timeLimit)) {
        return memorySession;
      }

      return {
        startTime,
        timeLimit,
      };
    } catch (error) {
      console.error('Failed to read quiz state from Redis:', error?.message || error);
      return memorySession;
    }
  };

  io.on('connection', (socket) => {
    // Connection log removed for cloud production

    socket.on('join_lesson', async (lessonId) => {
      const lessonRoom = normalizeId(lessonId);
      if (!lessonRoom) {
        return;
      }

      socket.join(lessonRoom);
      // Join log removed
      socket.to(lessonRoom).emit('user_joined', { id: socket.id });

      const sockets = await io.in(lessonRoom).fetchSockets();
      io.to(lessonRoom).emit('attendance_updated', { count: sockets.length });
    });

    socket.on('send_message', (data) => {
      io.to(data.lessonId).emit('receive_message', data);
    });

    socket.on('start_quiz', async (data) => {
      try {
        const allowed = await isFinalQuizBlock({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
        });
        if (!allowed) {
          return;
        }

        await setQuizSession({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
          timeLimit: data?.timeLimit,
        });
        io.to(data.lessonId).emit('quiz_started', data);
      } catch (error) {
        console.error('Failed to start quiz session:', error?.message || error);
      }
    });

    socket.on('stop_quiz', async (data) => {
      try {
        const allowed = await isFinalQuizBlock({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
        });
        if (!allowed) {
          return;
        }

        await clearQuizSession({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
        });
        io.to(data.lessonId).emit('quiz_stopped', data);
      } catch (error) {
        console.error('Failed to stop quiz session:', error?.message || error);
      }
    });

    socket.on('submit_answer', async (data) => {
      try {
        const allowed = await isFinalQuizBlock({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
        });
        if (!allowed) {
          return;
        }

        const session = await getQuizSession({
          lessonId: data?.lessonId,
          blockId: data?.blockId,
        });
        if (!session) {
          return;
        }
        let score = 0;

        if (data.pointsEarned !== undefined && Number.isFinite(Number(data.pointsEarned))) {
          score = Number(data.pointsEarned);
        } else {
          const timeElapsed = (now() - session.startTime) / 1000;
          const timeLeft = Math.max(0, session.timeLimit - timeElapsed);
          score = 1000 + Math.round(timeLeft * 50);
        }

        io.to(data.lessonId).emit('answer_received', { ...data, score });
      } catch (error) {
        console.error('Failed to score quiz answer:', error?.message || error);
      }
    });

    socket.on('chat_lock', (data) => {
      io.to(data.lessonId).emit('chat_locked', data);
    });

    socket.on('chat_unlock', (data) => {
      io.to(data.lessonId).emit('chat_unlocked', data);
    });

    socket.on('start_final_quiz', (data) => {
      io.to(data.lessonId).emit('start_final_quiz', data);
    });

    socket.on('show_leaderboard', (data) => {
      io.to(data.lessonId).emit('show_leaderboard', data);
    });

    socket.on('join_class_presence', async (data) => {
      const classId = normalizeId(data?.classId);
      const userId = normalizeId(data?.userId);
      const role = normalizeId(data?.role).toUpperCase();

      if (!classId || !userId || !role) {
        return;
      }

      try {
        await addClassPresence({
          classId,
          userId,
          role,
          socketId: socket.id,
        });

        socket.join(`class_presence:${classId}`);
        io.to(`class_presence:${classId}`).emit('class_presence_updated', {
          classId,
          onlineStudentIds: await getOnlineStudentIdsForClass(classId),
        });
      } catch (error) {
        console.error('Failed to join class presence channel:', error?.message || error);
      }
    });

    socket.on('leave_class_presence', async (data) => {
      const classId = normalizeId(data?.classId);
      const userId = normalizeId(data?.userId);
      if (!classId || !userId) {
        return;
      }

      try {
        await removeClassPresence({
          classId,
          userId,
          socketId: socket.id,
        });

        socket.leave(`class_presence:${classId}`);
        io.to(`class_presence:${classId}`).emit('class_presence_updated', {
          classId,
          onlineStudentIds: await getOnlineStudentIdsForClass(classId),
        });
      } catch (error) {
        console.error('Failed to leave class presence channel:', error?.message || error);
      }
    });

    socket.on('disconnecting', async () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          const sockets = await io.in(room).fetchSockets();
          io.to(room).emit('attendance_updated', { count: Math.max(0, sockets.length - 1) });
        }
      }
    });

    socket.on('disconnect', async () => {
      try {
        const affectedClassIds = await removeSocketPresence(socket.id);
        for (const classId of affectedClassIds) {
          io.to(`class_presence:${classId}`).emit('class_presence_updated', {
            classId,
            onlineStudentIds: await getOnlineStudentIdsForClass(classId),
          });
        }
      } catch (error) {
        console.error('Failed to clean up socket presence:', error?.message || error);
      } finally {
        // Disconnect log removed
      }
    });
  });

  return {
    activeQuizSessions,
  };
}

module.exports = {
  registerRealtimeHandlers,
};
