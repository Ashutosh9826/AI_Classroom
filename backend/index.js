const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ override: true });
const { registerRealtimeHandlers } = require('./realtime/registerRealtimeHandlers');

const app = express();
const server = http.createServer(app);
const parseBooleanEnv = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const corsAllowAll = parseBooleanEnv(process.env.CORS_ALLOW_ALL);
const frontendOrigin = String(process.env.FRONTEND_URL || 'http://localhost:5173').trim();
const extraFrontendOrigins = String(process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  frontendOrigin,
  ...extraFrontendOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const corsOptions = {
  origin(origin, callback) {
    if (corsAllowAll || !origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type']
};
const io = new Server(server, {
  cors: corsOptions
});
const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });
const PORT = process.env.PORT || 8080;

const requestBodyLimit = String(process.env.REQUEST_BODY_LIMIT || '30mb').trim() || '30mb';
app.use(cors(corsOptions));
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

// Basic health check route
app.get('/', (req, res) => {
  res.send('Academic Atelier Backend API is running!');
});

// Import routers
const authRoutes = require('./routes/auth');
const classesRoutes = require('./routes/classes');
const assignmentsRoutes = require('./routes/assignments');
const lessonsRoutes = require('./routes/lessons');
const chatRoutes = require('./routes/chat');
const attendanceRoutes = require('./routes/attendance');
const announcementsRoutes = require('./routes/announcements');
const codeExecutionRoutes = require('./routes/codeExecution');
const notesRoutes = require('./routes/notes');
const materialsRoutes = require('./routes/materials');

// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/lessons', lessonsRoutes);
app.use('/api/lesson-chat', chatRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/execute-code', codeExecutionRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/materials', materialsRoutes);
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error:
        'Request payload is too large. Reduce reference file size/count and try again.',
    });
  }

  if (err instanceof SyntaxError && err?.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request payload.' });
  }

  return next(err);
});

// Example route to get all classes
app.get('/classes', async (req, res) => {
  try {
    const classes = await prisma.class.findMany();
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

registerRealtimeHandlers(io);

async function configureRedisAdapter() {
  if (!process.env.REDIS_URL) {
    return;
  }

  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
}

async function startServer() {
  await configureRedisAdapter();
  console.log(
    `CORS mode: ${corsAllowAll ? 'allow_all' : 'allowlist'} (allowlisted origins: ${allowedOrigins.size})`
  );
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
