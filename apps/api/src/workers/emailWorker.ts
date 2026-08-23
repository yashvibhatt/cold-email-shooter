import { Worker, Job } from 'bullmq';
import { EmailStatus } from '@prisma/client';
import { EmailJobData, emailQueue } from '../queues/emailQueue';
import { prisma } from '../db/prisma';
import { sendMail } from '../services/mailService';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { emailJobId, userId } = job.data;

  logger.info('Processing email job', { emailJobId, attempt: job.attemptsMade + 1 });

  const emailJob = await prisma.emailJob.findUnique({ where: { id: emailJobId } });

  if (!emailJob) {
    logger.warn('Email job not found, skipping', { emailJobId });
    return;
  }
  if (emailJob.status === EmailStatus.CANCELLED) {
    logger.info('Email job was cancelled, skipping', { emailJobId });
    return;
  }
  if (emailJob.status === EmailStatus.SENT) {
    logger.warn('Email job already sent, skipping', { emailJobId });
    return;
  }

  // Guard against concurrent workers: only proceed if status is SCHEDULED/PENDING
  const updated = await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: { in: [EmailStatus.SCHEDULED, EmailStatus.PENDING] } },
    data: { status: EmailStatus.SCHEDULED },
  });
  if (updated.count === 0) {
    logger.warn('Concurrent worker detected or status changed, skipping', { emailJobId });
    return;
  }

  // If the scheduled time was more than 30 minutes ago, the server was probably
  // down for a long time and sending now would surprise the user.
  const overdueMs = Date.now() - new Date(emailJob.scheduledDatetime).getTime();
  if (overdueMs > 30 * 60 * 1000) {
    const minutesLate = Math.round(overdueMs / 60000);
    const reason = `Scheduled time expired — would have sent ${minutesLate} min late after server recovery`;
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: EmailStatus.FAILED, failedReason: reason },
    });
    logger.warn('Email job expired — skipping late send', { emailJobId, minutesLate });
    return;
  }

  try {
    const attachmentIds = Array.isArray(emailJob.attachmentIds)
      ? (emailJob.attachmentIds as string[])
      : [];

    await sendMail({
      userId,
      to: emailJob.recipientEmail,
      subject: emailJob.subject,
      body: emailJob.body,
      attachmentIds,
      provider: emailJob.provider,
    });

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: EmailStatus.SENT, sentAt: new Date(), failedReason: null },
    });

    await prisma.emailSendLog.create({
      data: {
        emailJobId,
        status: 'SUCCESS',
        message: env.SAFE_MODE
          ? 'Email logged (SAFE_MODE active – not actually sent)'
          : 'Email sent successfully',
        metadata: { safeMode: env.SAFE_MODE },
      },
    });

    logger.info('Email job completed', { emailJobId, safeMode: env.SAFE_MODE });
  } catch (err) {
    const failedReason = err instanceof Error ? err.message : String(err);
    const isAuthError = (err as any)?.code === 'AUTH_RELOGIN_REQUIRED';

    await prisma.emailSendLog.create({
      data: {
        emailJobId,
        status: 'FAILURE',
        message: failedReason,
        metadata: { attempt: job.attemptsMade + 1, authError: isAuthError },
      },
    }).catch(() => {});

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { retryCount: { increment: 1 }, failedReason },
    }).catch(() => {});

    logger.error('Email job attempt failed', {
      emailJobId,
      attempt: job.attemptsMade + 1,
      error: failedReason,
      authError: isAuthError,
    });

    // Auth errors won't fix themselves on retry — fail immediately
    if (isAuthError) {
      await prisma.emailJob.update({
        where: { id: emailJobId },
        data: { status: EmailStatus.FAILED, failedReason },
      }).catch(() => {});
      return; // don't rethrow — no point retrying
    }

    throw err;
  }
}

/**
 * Runs on worker startup to sync any jobs that are in BullMQ's failed queue
 * but still show SCHEDULED in the DB (happens when the server crashed mid-retry).
 */
async function syncFailedJobsFromBullMQ(): Promise<void> {
  try {
    const failedJobs = await emailQueue.getFailed(0, 200);
    if (failedJobs.length === 0) return;

    let synced = 0;
    for (const job of failedJobs) {
      const emailJobId = job.data?.emailJobId;
      if (!emailJobId) continue;
      const result = await prisma.emailJob.updateMany({
        where: { id: emailJobId, status: { notIn: [EmailStatus.FAILED, EmailStatus.CANCELLED, EmailStatus.SENT] } },
        data: { status: EmailStatus.FAILED, failedReason: job.failedReason ?? 'All retries exhausted' },
      });
      if (result.count > 0) synced++;
    }

    if (synced > 0) {
      logger.info(`Synced ${synced} stale SCHEDULED → FAILED jobs from BullMQ on startup`);
    }
  } catch (err) {
    logger.warn('Could not sync failed jobs from BullMQ', { error: (err as Error).message });
  }
}

export function initEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>('email-send', processEmailJob, {
    connection,
    concurrency: 5,
  });

  // This fires after EVERY failed attempt (not just the last one).
  // We use it as the definitive source of truth for marking permanent failures.
  worker.on('failed', async (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 3;
    const isPermanentlyFailed = job.attemptsMade >= maxAttempts;

    if (isPermanentlyFailed) {
      await prisma.emailJob.update({
        where: { id: job.data.emailJobId },
        data: { status: EmailStatus.FAILED, failedReason: err.message },
      }).catch((dbErr) => {
        logger.error('Could not mark email job FAILED after final retry', {
          emailJobId: job.data.emailJobId,
          error: dbErr.message,
        });
      });
      logger.error('Email job permanently failed after all retries', {
        emailJobId: job.data.emailJobId,
        error: err.message,
      });
    }
  });

  worker.on('completed', (job) => {
    logger.debug('Worker: job completed', { jobId: job.id });
  });

  worker.on('error', (err) => {
    logger.error('Worker connection error', { error: err.message });
  });

  // Sync DB with BullMQ state on every startup
  syncFailedJobsFromBullMQ();

  logger.info('Email worker started');
  return worker;
}
