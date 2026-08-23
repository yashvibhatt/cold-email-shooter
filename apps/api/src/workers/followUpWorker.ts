import { Worker, Job } from 'bullmq';
import { FollowUpJobData, followUpQueue } from '../queues/followUpQueue';
import { prisma } from '../db/prisma';
import { sendFollowUp } from '../services/mailService';
import { guessFirstName, guessCompany, applyFollowUpTemplate } from '../utils/personalize';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

async function processFollowUpJob(job: Job<FollowUpJobData>): Promise<void> {
  const { followUpId, userId, provider, recipientEmail, originalSubject, originalSentAtIso, message } = job.data;

  logger.info('Processing scheduled follow-up', { followUpId, recipientEmail, attempt: job.attemptsMade + 1 });

  // Personalization is resolved fresh at send time, not at schedule time —
  // matches the immediate-send endpoints and keeps behavior consistent
  // regardless of how long the follow-up sat in the queue.
  let originalBody: string | null = null;
  if (followUpId) {
    const followUp = await prisma.followUp.findUnique({ where: { id: followUpId } });
    if (!followUp) {
      logger.warn('Scheduled follow-up record no longer exists, skipping', { followUpId });
      return;
    }

    // Hard rule: never send a follow-up to someone who has already replied,
    // even if they responded after this was scheduled.
    if (followUp.status === 'RESPONDED') {
      logger.info('Recipient already responded — skipping scheduled follow-up', { followUpId, recipientEmail });
      return;
    }

    const emailJob = await prisma.emailJob.findUnique({ where: { id: followUp.emailJobId } });
    originalBody = emailJob?.body ?? null;
  } else {
    // One-off Sent Log follow-up with no tracked FollowUp row — still check
    // whether this recipient has replied to anything else, by email address.
    const anyResponded = await prisma.followUp.findFirst({
      where: { userId, recipientEmail: { equals: recipientEmail, mode: 'insensitive' }, status: 'RESPONDED' },
    });
    if (anyResponded) {
      logger.info('Recipient already responded (matched by email) — skipping scheduled follow-up', { recipientEmail });
      return;
    }
  }

  const firstName = guessFirstName(originalBody, recipientEmail);
  const company = guessCompany(recipientEmail);

  await sendFollowUp({
    userId,
    provider,
    to: recipientEmail,
    originalSubject,
    originalSentAtIso,
    replyBody: applyFollowUpTemplate(message, firstName, company),
  });

  if (followUpId) {
    await prisma.followUp.update({
      where: { id: followUpId },
      data: { followUpCount: { increment: 1 }, lastFollowUpSentAt: new Date() },
    });
  }

  logger.info('Scheduled follow-up sent', { followUpId, recipientEmail });
}

export function initFollowUpWorker(): Worker<FollowUpJobData> {
  const worker = new Worker<FollowUpJobData>('followup-send', processFollowUpJob, {
    connection,
    concurrency: 3,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      logger.error('Scheduled follow-up permanently failed after all retries', {
        followUpId: job.data.followUpId,
        recipientEmail: job.data.recipientEmail,
        error: err.message,
      });
    }
  });

  worker.on('error', (err) => {
    logger.error('Follow-up worker connection error', { error: err.message });
  });

  logger.info('Follow-up worker started');
  return worker;
}

export { followUpQueue };
