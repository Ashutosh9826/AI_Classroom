const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/authMiddleware');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

const toClientUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  has_password: Boolean(user.password),
  avatar_url: user.avatar_url || null,
  notify_assignments: user.notify_assignments,
  notify_due_soon: user.notify_due_soon,
  notify_announcements: user.notify_announcements,
  created_at: user.created_at,
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Validate role
    const userRole = role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: userRole
      }
    });

    const token = jwt.sign(
      { userId: newUser.id, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: toClientUser(newUser)
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const requestedRole = role === 'TEACHER' || role === 'STUDENT' ? role : null;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || (!user.password && password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({
        error: `This account is registered as ${user.role}. Switch the role toggle to ${user.role} or use a different account.`,
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: toClientUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Google OAuth
router.post('/google', async (req, res) => {
  try {
    const { credential, role } = req.body;
    const { OAuth2Client } = require('google-auth-library');
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const { email, name, picture, sub: googleId } = payload;
    const userRole = role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name,
          email,
          role: userRole,
          // No password for Google-only users
        },
      });
    } else if (user.role !== userRole) {
      return res.status(403).json({
        error: `This account is registered as ${user.role}. Select ${user.role} to continue with Google sign-in.`,
      });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: toClientUser(user),
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// Get current user profile/settings
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(toClientUser(user));
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update current user profile/settings
router.patch('/me', authenticateToken, async (req, res) => {
  try {
    const { name, avatar_url, notify_assignments, notify_due_soon, notify_announcements } = req.body;

    const updateData = {};
    if (typeof name === 'string') {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updateData.name = trimmedName;
    }

    if (avatar_url !== undefined) {
      if (avatar_url === null || avatar_url === '') {
        updateData.avatar_url = null;
      } else if (typeof avatar_url === 'string') {
        updateData.avatar_url = avatar_url.trim();
      } else {
        return res.status(400).json({ error: 'Invalid avatar URL' });
      }
    }

    if (typeof notify_assignments === 'boolean') {
      updateData.notify_assignments = notify_assignments;
    }
    if (typeof notify_due_soon === 'boolean') {
      updateData.notify_due_soon = notify_due_soon;
    }
    if (typeof notify_announcements === 'boolean') {
      updateData.notify_announcements = notify_announcements;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
    });

    return res.json(toClientUser(updated));
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.patch('/me/password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const isMatch = await bcrypt.compare(current_password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { password: hashed },
    });

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
