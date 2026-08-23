import { Queue } from 'bullmq';
import { EmailProvider } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface FollowUpJobData {
  followUpId: string | null; // null for one-off Sent Log follow-ups not tied to a FollowUp record
  userId: string;
  provider: EmailProvider;
  recipientEmail: string;
  originalSubject: string;
  originalSentAtIso: string;
  message: string;
}

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

export const followUpQueue = new Queue<FollowUpJobData>('followup-send', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

followUpQueue.on('error', (err) => {
  logger.error('Follow-up queue error', { error: err.message });
});

/**
 * Schedules a follow-up send for a future time. Uses BullMQ's delay so it
 * survives server restarts (Redis-backed), matching how campaign sends work.
 */
export async function scheduleFollowUpSend(data: FollowUpJobData, scheduledAt: Date): Promise<void> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());

  await followUpQueue.add('send-followup', data, { delay });

  logger.debug('Follow-up send queued', {
    followUpId: data.followUpId,
    recipientEmail: data.recipientEmail,
    scheduledAt: scheduledAt.toISOString(),
    delaySeconds: Math.round(delay / 1000),
  });
}
