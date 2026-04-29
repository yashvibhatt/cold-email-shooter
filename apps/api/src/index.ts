import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { createClient } from 'redis';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import { authRouter } from './routes/auth';
import { emailsRouter } from './routes/emails';
import { filesRouter } from './routes/files';
import { attachmentsRouter } from './routes/attachments';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { initEmailWorker } from './workers/emailWorker';
import { prisma } from './db/prisma';
import RedisStore from 'connect-redis';

// Ensure logs directory exists
fs.mkdirSync('logs', { recursive: true });
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const app = express();

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── Session (Redis-backed) ────────────────────────────────────────────────────
const redisClient = createClient({ url: env.REDIS_URL });
redisClient.connect().catch((err) => {
  logger.error('Redis connection failed', { error: (err as Error).message });
  process.exit(1);
});

app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'ces.sid',
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
    },
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/files', filesRouter);
app.use('/api/attachments', attachmentsRouter);

// Health check
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      safeMode: env.SAFE_MODE,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

// ─── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    const worker = initEmailWorker();

    const server = app.listen(env.PORT, () => {
      logger.info(`API server running on http://localhost:${env.PORT}`);
      logger.info(`SAFE_MODE: ${env.SAFE_MODE ? 'ON (emails will NOT be sent)' : 'OFF (emails WILL be sent)'}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received – shutting down gracefully`);
      server.close(async () => {
        await worker.close();
        await prisma.$disconnect();
        await redisClient.quit();
        logger.info('Server shut down cleanly');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Startup failed', { error: (err as Error).message });
    process.exit(1);
  }
}

start();
