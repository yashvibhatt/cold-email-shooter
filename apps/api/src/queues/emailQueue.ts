import { Queue } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface EmailJobData {
  emailJobId: string;
  userId: string;
}

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

export const emailQueue = new Queue<EmailJobData>('email-send', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

emailQueue.on('error', (err) => {
  logger.error('Email queue error', { error: err.message });
});

/**
 * Schedules an email job in the queue with the correct delay.
 * Uses the emailJobId as the BullMQ job ID to prevent duplicates.
 */
export async function scheduleEmailJob(
  emailJobId: string,
  userId: string,
  scheduledAt: Date
): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, scheduledAt.getTime() - now);

  await emailQueue.add(
    'send-email',
    { emailJobId, userId },
    {
      jobId: emailJobId, // deduplicate by job ID
      delay,
    }
  );

  logger.debug('Email job queued', {
    emailJobId,
    scheduledAt: scheduledAt.toISOString(),
    delaySeconds: Math.round(delay / 1000),
  });
}
