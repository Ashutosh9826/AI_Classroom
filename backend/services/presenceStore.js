const { getRedisClient } = require('./redisClient');

const classPresenceMap = new Map();
const socketIndex = new Map();

const normalizeRole = (role) => String(role || '').toUpperCase();

const classOnlineKey = (classId) => `class:${classId}:online`;
const classUserSocketsKey = (classId, userId) => `class:${classId}:user:${userId}:sockets`;
const socketMembershipKey = (socketId) => `socket:${socketId}:classes`;

const encodeSocketMembership = ({ classId, userId, role }) => `${classId}|${userId}|${role}`;
const decodeSocketMembership = (value) => {
  const [classId = '', userId = '', role = ''] = String(value || '').split('|');
  return {
    classId: String(classId || '').trim(),
    userId: String(userId || '').trim(),
    role: String(role || '').trim().toUpperCase(),
  };
};

const runWithRedisFallback = async (redisHandler, memoryHandler) => {
  const redisClient = await getRedisClient();
  if (!redisClient) {
    return memoryHandler();
  }

  try {
    return await redisHandler(redisClient);
  } catch (error) {
    console.error(
      'Redis presence operation failed. Falling back to in-memory state.',
      error?.message || error
    );
    return memoryHandler();
  }
};

const addClassPresenceMemory = ({ classId, userId, role, socketId }) => {
  const safeClassId = String(classId || '').trim();
  const safeUserId = String(userId || '').trim();
  const safeSocketId = String(socketId || '').trim();
  const safeRole = normalizeRole(role);

  if (!safeClassId || !safeUserId || !safeSocketId || !safeRole) {
    return;
  }

  if (!classPresenceMap.has(safeClassId)) {
    classPresenceMap.set(safeClassId, new Map());
  }

  const classUsers = classPresenceMap.get(safeClassId);
  if (!classUsers.has(safeUserId)) {
    classUsers.set(safeUserId, { role: safeRole, sockets: new Set() });
  }

  const entry = classUsers.get(safeUserId);
  entry.role = safeRole;
  entry.sockets.add(safeSocketId);

  if (!socketIndex.has(safeSocketId)) {
    socketIndex.set(safeSocketId, []);
  }
  const indexed = socketIndex.get(safeSocketId);
  const exists = indexed.some((item) => item.classId === safeClassId && item.userId === safeUserId);
  if (!exists) {
    indexed.push({ classId: safeClassId, userId: safeUserId });
  }
};

const removeClassPresenceMemory = ({ classId, userId, socketId }) => {
  const safeClassId = String(classId || '').trim();
  const safeUserId = String(userId || '').trim();
  const safeSocketId = String(socketId || '').trim();

  if (!safeClassId || !safeUserId || !safeSocketId) {
    return;
  }

  const classUsers = classPresenceMap.get(safeClassId);
  if (!classUsers) return;

  const entry = classUsers.get(safeUserId);
  if (!entry) return;

  entry.sockets.delete(safeSocketId);
  if (entry.sockets.size === 0) {
    classUsers.delete(safeUserId);
  }
  if (classUsers.size === 0) {
    classPresenceMap.delete(safeClassId);
  }

  const indexed = socketIndex.get(safeSocketId);
  if (indexed) {
    socketIndex.set(
      safeSocketId,
      indexed.filter((item) => !(item.classId === safeClassId && item.userId === safeUserId))
    );
    if (socketIndex.get(safeSocketId).length === 0) {
      socketIndex.delete(safeSocketId);
    }
  }
};

const removeSocketPresenceMemory = (socketId) => {
  const safeSocketId = String(socketId || '').trim();
  if (!safeSocketId) return [];

  const indexed = socketIndex.get(safeSocketId) || [];
  const affectedClassIds = new Set();
  indexed.forEach(({ classId, userId }) => {
    affectedClassIds.add(classId);
    const classUsers = classPresenceMap.get(classId);
    if (!classUsers) return;

    const entry = classUsers.get(userId);
    if (!entry) return;

    entry.sockets.delete(safeSocketId);
    if (entry.sockets.size === 0) {
      classUsers.delete(userId);
    }

    if (classUsers.size === 0) {
      classPresenceMap.delete(classId);
    }
  });

  socketIndex.delete(safeSocketId);
  return [...affectedClassIds];
};

const getOnlineStudentIdsForClassMemory = (classId) => {
  const safeClassId = String(classId || '').trim();
  if (!safeClassId) return [];

  const classUsers = classPresenceMap.get(safeClassId);
  if (!classUsers) return [];

  const studentIds = [];
  classUsers.forEach((entry, userId) => {
    if (entry.role === 'STUDENT' && entry.sockets.size > 0) {
      studentIds.push(userId);
    }
  });

  return studentIds;
};

const addClassPresence = async ({ classId, userId, role, socketId }) => {
  const safeClassId = String(classId || '').trim();
  const safeUserId = String(userId || '').trim();
  const safeSocketId = String(socketId || '').trim();
  const safeRole = normalizeRole(role);

  if (!safeClassId || !safeUserId || !safeSocketId || !safeRole) {
    return;
  }

  return runWithRedisFallback(
    async (redisClient) => {
      await redisClient.sAdd(
        socketMembershipKey(safeSocketId),
        encodeSocketMembership({
          classId: safeClassId,
          userId: safeUserId,
          role: safeRole,
        })
      );
      await redisClient.sAdd(classUserSocketsKey(safeClassId, safeUserId), safeSocketId);
      if (safeRole === 'STUDENT') {
        await redisClient.sAdd(classOnlineKey(safeClassId), safeUserId);
      }
    },
    () =>
      addClassPresenceMemory({
        classId: safeClassId,
        userId: safeUserId,
        role: safeRole,
        socketId: safeSocketId,
      })
  );
};

const removeClassPresence = async ({ classId, userId, socketId }) => {
  const safeClassId = String(classId || '').trim();
  const safeUserId = String(userId || '').trim();
  const safeSocketId = String(socketId || '').trim();

  if (!safeClassId || !safeUserId || !safeSocketId) {
    return;
  }

  return runWithRedisFallback(
    async (redisClient) => {
      const socketKey = socketMembershipKey(safeSocketId);
      const socketEntries = await redisClient.sMembers(socketKey);
      const entriesToRemove = socketEntries.filter((entry) => {
        const parsed = decodeSocketMembership(entry);
        return parsed.classId === safeClassId && parsed.userId === safeUserId;
      });
      if (entriesToRemove.length > 0) {
        await redisClient.sRem(socketKey, entriesToRemove);
      }

      const userSocketsKey = classUserSocketsKey(safeClassId, safeUserId);
      await redisClient.sRem(userSocketsKey, safeSocketId);

      const remainingSockets = await redisClient.sCard(userSocketsKey);
      if (remainingSockets === 0) {
        await redisClient.del(userSocketsKey);
        await redisClient.sRem(classOnlineKey(safeClassId), safeUserId);
      }

      const remainingSocketMemberships = await redisClient.sCard(socketKey);
      if (remainingSocketMemberships === 0) {
        await redisClient.del(socketKey);
      }
    },
    () =>
      removeClassPresenceMemory({
        classId: safeClassId,
        userId: safeUserId,
        socketId: safeSocketId,
      })
  );
};

const removeSocketPresence = async (socketId) => {
  const safeSocketId = String(socketId || '').trim();
  if (!safeSocketId) return [];

  return runWithRedisFallback(
    async (redisClient) => {
      const socketKey = socketMembershipKey(safeSocketId);
      const entries = await redisClient.sMembers(socketKey);
      const affectedClassIds = new Set();

      for (const entry of entries) {
        const { classId, userId } = decodeSocketMembership(entry);
        if (!classId || !userId) continue;

        affectedClassIds.add(classId);
        const userSocketsKey = classUserSocketsKey(classId, userId);
        await redisClient.sRem(userSocketsKey, safeSocketId);

        const remainingSockets = await redisClient.sCard(userSocketsKey);
        if (remainingSockets === 0) {
          await redisClient.del(userSocketsKey);
          await redisClient.sRem(classOnlineKey(classId), userId);
        }
      }

      await redisClient.del(socketKey);
      return [...affectedClassIds];
    },
    () => removeSocketPresenceMemory(safeSocketId)
  );
};

const getOnlineStudentIdsForClass = async (classId) => {
  const safeClassId = String(classId || '').trim();
  if (!safeClassId) return [];

  return runWithRedisFallback(
    async (redisClient) => redisClient.sMembers(classOnlineKey(safeClassId)),
    () => getOnlineStudentIdsForClassMemory(safeClassId)
  );
};

module.exports = {
  addClassPresence,
  removeClassPresence,
  removeSocketPresence,
  getOnlineStudentIdsForClass,
};
