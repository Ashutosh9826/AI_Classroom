const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const prisma = new PrismaClient();

const normalizeRole = (role) => {
  const normalized = String(role || '').trim().toUpperCase();
  if (normalized === 'TEACHER' || normalized === 'STUDENT') {
    return normalized;
  }
  return null;
};

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Backward-compatible payload support:
    // older tokens may carry "id" instead of "userId".
    const normalizedUserId = payload?.userId || payload?.id || null;
    if (!normalizedUserId) {
      return res.status(401).json({ error: 'Invalid token payload. Please sign in again.' });
    }

    // Always use the canonical role from DB so role changes are reflected immediately
    // and stale tokens do not block valid teacher actions.
    const user = await prisma.user.findUnique({
      where: { id: normalizedUserId },
      select: { id: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found. Please sign in again.' });
    }

    const normalizedRole = normalizeRole(user.role || payload?.role);
    if (!normalizedRole) {
      return res.status(401).json({ error: 'Invalid user role. Please sign in again.' });
    }

    req.user = {
      ...payload,
      userId: user.id,
      role: normalizedRole,
    };
    return next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireTeacher(req, res, next) {
  if (req.user && req.user.role === 'TEACHER') {
    next();
  } else {
    res.status(403).json({ error: 'Teacher access required' });
  }
}

module.exports = { authenticateToken, requireTeacher };
