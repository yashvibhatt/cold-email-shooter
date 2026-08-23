import { Router, Request, Response, NextFunction } from 'express';
import { FollowUpStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getValidAccessToken } from '../services/tokenService';
import { getInboxReplies, detectManualFollowUps } from '../services/graphService';
import { sendFollowUp } from '../services/mailService';
import { scheduleFollowUpSend } from '../queues/followUpQueue';
import { guessFirstName, guessCompany, applyFollowUpTemplate } from '../utils/personalize';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { NotFoundError, ValidationError, AppError } from '../utils/validation';
import { logger } from '../utils/logger';

export const followUpRouter = Router();

// How long to wait after sending before flagging silence as "no response"
// (avoids flagging emails sent minutes ago).
const NO_RESPONSE_GRACE_HOURS = 24;

/**
 * Joins each follow-up row with the provider and sender address of the
 * original email job (not stored on FollowUp itself).
 */
async function withSenderInfo(
  followUps: Awaited<ReturnType<typeof prisma.followUp.findMany>>,
  userId: string
) {
  if (followUps.length === 0) return [];

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const emailJobs = await prisma.emailJob.findMany({
    where: { id: { in: followUps.map((f) => f.emailJobId) } },
    select: { id: true, provider: true, timezone: true, company: true, location: true },
  });
  const jobById = new Map(emailJobs.map((j) => [j.id, j]));

  return followUps.map((f) => {
    const job = jobById.get(f.emailJobId);
    const provider = job?.provider ?? 'OUTLOOK';
    const senderEmail = provider === 'GMAIL' ? user?.googleEmail ?? null : user?.email ?? null;
    return {
      ...f,
      provider,
      senderEmail,
      timezone: job?.timezone ?? null,
      company: job?.company ?? null,
      location: job?.location ?? null,
    };
  });
}

// POST /api/followup/scan?days=14 — scans Inbox for replies/OOO and refreshes the follow-up list
followUpRouter.post(
  '/scan',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Most recent SENT job per recipient within the window
      const sentJobs = await prisma.emailJob.findMany({
        where: { userId: currentUser.id, status: 'SENT', sentAt: { gte: since } },
        orderBy: { sentAt: 'desc' },
        select: { id: true, recipientEmail: true, subject: true, sentAt: true },
      });

      const latestJobByRecipient = new Map<string, (typeof sentJobs)[number]>();
      for (const job of sentJobs) {
        const key = job.recipientEmail.toLowerCase();
        if (!latestJobByRecipient.has(key)) latestJobByRecipient.set(key, job); // already ordered desc
      }

      const accessToken = await getValidAccessToken(currentUser.id);
      const replies = await getInboxReplies(accessToken, since.toISOString());

      const latestReplyByAddress = new Map<string, (typeof replies)[number]>();
      for (const reply of replies) {
        const key = reply.fromAddress.toLowerCase();
        const existing = latestReplyByAddress.get(key);
        if (!existing || new Date(reply.receivedAt) > new Date(existing.receivedAt)) {
          latestReplyByAddress.set(key, reply);
        }
      }

      const now = Date.now();
      let flagged = 0;
      let resolved = 0;

      for (const [recipientKey, job] of latestJobByRecipient) {
        const reply = latestReplyByAddress.get(recipientKey);
        const hasGenuineReply = reply && new Date(reply.receivedAt) > job.sentAt!;

        let status: FollowUpStatus;
        let oooNote: string | null = null;
        let oooReturnDate: Date | null = null;

        if (hasGenuineReply && !reply!.isOutOfOffice) {
          // They replied for real — keep the record (don't delete it) so it
          // shows up in the "Responded" list instead of just vanishing.
          status = FollowUpStatus.RESPONDED;
          oooNote = reply!.replyPreview;
          resolved++;
        } else if (hasGenuineReply && reply!.isOutOfOffice) {
          status = FollowUpStatus.OUT_OF_OFFICE;
          oooNote = reply!.oooNote;
          oooReturnDate = reply!.oooReturnDate ? new Date(reply!.oooReturnDate) : null;
        } else {
          const hoursSinceSent = (now - job.sentAt!.getTime()) / (1000 * 60 * 60);
          if (hoursSinceSent < NO_RESPONSE_GRACE_HOURS) continue; // too soon to flag
          status = FollowUpStatus.NO_RESPONSE;
        }

        await prisma.followUp.upsert({
          where: { userId_emailJobId: { userId: currentUser.id, emailJobId: job.id } },
          create: {
            userId: currentUser.id,
            emailJobId: job.id,
            recipientEmail: job.recipientEmail,
            status,
            oooNote,
            oooReturnDate,
            originalSubject: job.subject,
            originalSentAt: job.sentAt!,
          },
          update: {
            status,
            oooNote,
            oooReturnDate,
            lastScannedAt: new Date(),
          },
        });
        flagged++;
      }

      logger.info('Follow-up scan completed', { userId: currentUser.id, days, flagged, resolved });

      const rawList = await prisma.followUp.findMany({
        where: { userId: currentUser.id },
        orderBy: [{ followedUp: 'asc' }, { originalSentAt: 'desc' }],
      });
      const list = await withSenderInfo(rawList, currentUser.id);

      res.json({ success: true, data: { flagged, resolved, list } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/followup/sync-manual — checks Sent Items for follow-ups sent by
// replying directly in Outlook (not through this app). Split out from /scan
// because it does one Graph search PER pending recipient — with a large
// pending list this can take minutes, long enough to time out if bundled
// into the regular scan. Run this on demand instead.
followUpRouter.post(
  '/sync-manual',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const accessToken = await getValidAccessToken(currentUser.id);

      const pendingRows = await prisma.followUp.findMany({
        where: { userId: currentUser.id, followedUp: false, status: { not: FollowUpStatus.RESPONDED } },
      });

      let manualSynced = 0;
      if (pendingRows.length > 0) {
        const providerByJobId = new Map(
          (
            await prisma.emailJob.findMany({
              where: { id: { in: pendingRows.map((r) => r.emailJobId) } },
              select: { id: true, provider: true },
            })
          ).map((j) => [j.id, j.provider])
        );

        const outlookPendingRows = pendingRows.filter(
          (r) => (providerByJobId.get(r.emailJobId) ?? 'OUTLOOK') === 'OUTLOOK'
        );

        const manualResults = await detectManualFollowUps(
          accessToken,
          outlookPendingRows.map((r) => ({ recipientEmail: r.recipientEmail, originalSentAtIso: r.originalSentAt.toISOString() }))
        );

        for (const row of outlookPendingRows) {
          const manual = manualResults.get(row.recipientEmail.toLowerCase());
          if (manual && manual.count > row.followUpCount) {
            await prisma.followUp.update({
              where: { id: row.id },
              data: {
                followUpCount: manual.count,
                lastFollowUpSentAt: manual.lastSentAt ? new Date(manual.lastSentAt) : null,
              },
            });
            manualSynced++;
          }
        }
      }

      logger.info('Manual follow-up sync completed', { userId: currentUser.id, checked: pendingRows.length, manualSynced });

      const rawList = await prisma.followUp.findMany({
        where: { userId: currentUser.id },
        orderBy: [{ followedUp: 'asc' }, { originalSentAt: 'desc' }],
      });
      const list = await withSenderInfo(rawList, currentUser.id);

      res.json({ success: true, data: { manualSynced, checked: pendingRows.length, list } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/followup — list current follow-ups without re-scanning
followUpRouter.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const rawList = await prisma.followUp.findMany({
        where: { userId: currentUser.id },
        orderBy: [{ followedUp: 'asc' }, { originalSentAt: 'desc' }],
      });
      const list = await withSenderInfo(rawList, currentUser.id);
      res.json({ success: true, data: { list } });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/followup/:id — toggle followedUp / dismiss
followUpRouter.patch(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { followedUp } = req.body as { followedUp?: boolean };

      if (typeof followedUp !== 'boolean') {
        throw new ValidationError('followedUp (boolean) is required');
      }

      const existing = await prisma.followUp.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });
      if (!existing) throw new NotFoundError('Follow-up not found');

      const updated = await prisma.followUp.update({
        where: { id: req.params.id },
        data: { followedUp, followedUpAt: followedUp ? new Date() : null },
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/followup/:id/send — sends the follow-up as a threaded reply to the original email
followUpRouter.post(
  '/:id/send',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { message, scheduledAt } = req.body as { message?: string; scheduledAt?: string };

      if (!message?.trim()) throw new ValidationError('message is required');
      if (scheduledAt && isNaN(Date.parse(scheduledAt))) throw new ValidationError('scheduledAt must be a valid ISO date');

      const followUp = await prisma.followUp.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });
      if (!followUp) throw new NotFoundError('Follow-up not found');
      if (followUp.status === 'RESPONDED') {
        throw new AppError('This person already replied — refusing to send another follow-up.', 422, 'ALREADY_RESPONDED');
      }

      const emailJob = await prisma.emailJob.findUnique({ where: { id: followUp.emailJobId } });
      if (!emailJob) throw new NotFoundError('Original email job not found');

      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      const isFutureSchedule = scheduledDate && scheduledDate.getTime() > Date.now() + 5000; // small buffer for clock skew

      if (isFutureSchedule) {
        await scheduleFollowUpSend(
          {
            followUpId: followUp.id,
            userId: currentUser.id,
            provider: emailJob.provider,
            recipientEmail: followUp.recipientEmail,
            originalSubject: followUp.originalSubject,
            originalSentAtIso: followUp.originalSentAt.toISOString(),
            message,
          },
          scheduledDate!
        );

        logger.info('Follow-up scheduled', {
          userId: currentUser.id,
          followUpId: req.params.id,
          scheduledAt: scheduledDate!.toISOString(),
        });

        res.json({ success: true, data: { scheduled: true, scheduledAt: scheduledDate!.toISOString(), followUp } });
        return;
      }

      const firstName = guessFirstName(emailJob.body, followUp.recipientEmail);
      const company = guessCompany(followUp.recipientEmail);

      await sendFollowUp({
        userId: currentUser.id,
        provider: emailJob.provider,
        to: followUp.recipientEmail,
        originalSubject: followUp.originalSubject,
        originalSentAtIso: followUp.originalSentAt.toISOString(),
        replyBody: applyFollowUpTemplate(message, firstName, company),
      });

      const updated = await prisma.followUp.update({
        where: { id: req.params.id },
        data: { followUpCount: { increment: 1 }, lastFollowUpSentAt: new Date() },
      });

      logger.info('Follow-up sent', { userId: currentUser.id, followUpId: req.params.id, provider: emailJob.provider });

      res.json({ success: true, data: { scheduled: false, ...updated } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/followup/bulk-send — sends the same follow-up message as a threaded reply to multiple recipients
followUpRouter.post(
  '/bulk-send',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { ids, message, scheduledAt } = req.body as { ids?: string[]; message?: string; scheduledAt?: string };

      if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('ids (non-empty array) is required');
      if (ids.length > 200) throw new ValidationError('Maximum 200 follow-ups per bulk send');
      if (!message?.trim()) throw new ValidationError('message is required');
      if (scheduledAt && isNaN(Date.parse(scheduledAt))) throw new ValidationError('scheduledAt must be a valid ISO date');
      const followUpMessage: string = message;

      const requestedFollowUps = await prisma.followUp.findMany({
        where: { id: { in: ids }, userId: currentUser.id },
      });

      // Never send to someone who's already replied, even if they were
      // selected before their reply came in.
      const followUps = requestedFollowUps.filter((f) => f.status !== 'RESPONDED');
      const skippedResponded = requestedFollowUps
        .filter((f) => f.status === 'RESPONDED')
        .map((f) => ({ id: f.id, recipientEmail: f.recipientEmail, success: false, error: 'Already responded — skipped' }));

      const emailJobs = await prisma.emailJob.findMany({
        where: { id: { in: followUps.map((f) => f.emailJobId) } },
      });
      const jobById = new Map(emailJobs.map((j) => [j.id, j]));

      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      const isFutureSchedule = scheduledDate && scheduledDate.getTime() > Date.now() + 5000;

      if (isFutureSchedule) {
        const results: Array<{ id: string; recipientEmail: string; success: boolean; error?: string }> = [...skippedResponded];

        for (const followUp of followUps) {
          const emailJob = jobById.get(followUp.emailJobId);
          if (!emailJob) {
            results.push({ id: followUp.id, recipientEmail: followUp.recipientEmail, success: false, error: 'Original email job not found' });
            continue;
          }
          await scheduleFollowUpSend(
            {
              followUpId: followUp.id,
              userId: currentUser.id,
              provider: emailJob.provider,
              recipientEmail: followUp.recipientEmail,
              originalSubject: followUp.originalSubject,
              originalSentAtIso: followUp.originalSentAt.toISOString(),
              message: followUpMessage,
            },
            scheduledDate!
          );
          results.push({ id: followUp.id, recipientEmail: followUp.recipientEmail, success: true });
        }

        const scheduledCount = results.filter((r) => r.success).length;
        logger.info('Bulk follow-up scheduled', { userId: currentUser.id, scheduledCount, scheduledAt: scheduledDate!.toISOString() });

        res.json({ success: true, data: { scheduled: true, sent: 0, failed: results.length - scheduledCount, scheduledCount, results } });
        return;
      }

      const results: Array<{ id: string; recipientEmail: string; success: boolean; error?: string }> = [...skippedResponded];

      const CONCURRENCY = 3;
      let cursor = 0;

      async function worker() {
        while (cursor < followUps.length) {
          const followUp = followUps[cursor++];
          const emailJob = jobById.get(followUp.emailJobId);

          if (!emailJob) {
            results.push({ id: followUp.id, recipientEmail: followUp.recipientEmail, success: false, error: 'Original email job not found' });
            continue;
          }

          try {
            const firstName = guessFirstName(emailJob.body, followUp.recipientEmail);
            const company = guessCompany(followUp.recipientEmail);

            await sendFollowUp({
              userId: currentUser.id,
              provider: emailJob.provider,
              to: followUp.recipientEmail,
              originalSubject: followUp.originalSubject,
              originalSentAtIso: followUp.originalSentAt.toISOString(),
              replyBody: applyFollowUpTemplate(followUpMessage, firstName, company),
            });

            await prisma.followUp.update({
              where: { id: followUp.id },
              data: { followUpCount: { increment: 1 }, lastFollowUpSentAt: new Date() },
            });

            results.push({ id: followUp.id, recipientEmail: followUp.recipientEmail, success: true });
          } catch (err: any) {
            results.push({ id: followUp.id, recipientEmail: followUp.recipientEmail, success: false, error: err?.message ?? 'Send failed' });
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, followUps.length) }, worker));

      const sent = results.filter((r) => r.success).length;
      const failed = results.length - sent;

      logger.info('Bulk follow-up send completed', { userId: currentUser.id, sent, failed });

      res.json({ success: true, data: { scheduled: false, sent, failed, results } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/followup/:id — remove from the list entirely
followUpRouter.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const existing = await prisma.followUp.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });
      if (!existing) throw new NotFoundError('Follow-up not found');

      await prisma.followUp.delete({ where: { id: req.params.id } });
      res.json({ success: true, data: { message: 'Removed' } });
    } catch (err) {
      next(err);
    }
  }
);
