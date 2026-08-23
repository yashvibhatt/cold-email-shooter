import { Router, Request, Response, NextFunction } from 'express';
import { getValidAccessToken } from '../services/tokenService';
import { getSentMessagesInRange, getInboxReplies } from '../services/graphService';
import { sendFollowUp } from '../services/mailService';
import { scheduleFollowUpSend } from '../queues/followUpQueue';
import { guessFirstName, guessCompany, applyFollowUpTemplate } from '../utils/personalize';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { prisma } from '../db/prisma';
import { ValidationError, AppError } from '../utils/validation';
import { logger } from '../utils/logger';

export const sentLogRouter = Router();

// GET /api/sent-log?since=ISO&until=ISO&excludeResponded=true
// Scans Outlook Sent Items for everything sent in [since, until) — catches
// manually-sent emails too, since it reads the real mailbox rather than the
// app's own DB. Optionally excludes anyone who's already sent a genuine
// (non-out-of-office) reply since then.
sentLogRouter.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { since, until } = req.query as Record<string, string>;
      const excludeResponded = req.query.excludeResponded === 'true';

      if (!since || isNaN(Date.parse(since))) throw new ValidationError('since (ISO date) is required');
      if (!until || isNaN(Date.parse(until))) throw new ValidationError('until (ISO date) is required');

      const accessToken = await getValidAccessToken(currentUser.id);
      const sent = await getSentMessagesInRange(accessToken, since, until);

      let entries = sent;
      let excludedEntries: typeof sent = [];

      if (excludeResponded && sent.length > 0) {
        const replies = await getInboxReplies(accessToken, since);

        // Latest genuine (non-OOO) reply per sender address
        const latestGenuineReply = new Map<string, string>(); // address -> receivedAt
        for (const reply of replies) {
          if (reply.isOutOfOffice) continue;
          const key = reply.fromAddress.toLowerCase();
          const existing = latestGenuineReply.get(key);
          if (!existing || new Date(reply.receivedAt) > new Date(existing)) {
            latestGenuineReply.set(key, reply.receivedAt);
          }
        }

        entries = [];
        for (const s of sent) {
          const replyAt = latestGenuineReply.get(s.recipientEmail.toLowerCase());
          const responded = !!replyAt && new Date(replyAt) > new Date(s.sentDateTime);
          if (responded) excludedEntries.push(s);
          else entries.push(s);
        }
      }

      const uniqueRecipients = new Set(entries.map((e) => e.recipientEmail.toLowerCase())).size;

      logger.info('Sent log scan completed', {
        userId: currentUser.id,
        since,
        until,
        totalSent: sent.length,
        excludedCount: excludedEntries.length,
        returned: entries.length,
      });

      res.json({
        success: true,
        data: {
          since,
          until,
          totalSent: sent.length,
          excludedCount: excludedEntries.length,
          uniqueRecipients,
          entries,
          excludedEntries,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/sent-log/send — sends a threaded follow-up reply to one entry from the sent log
sentLogRouter.post(
  '/send',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { recipientEmail, subject, sentDateTime, message, scheduledAt } = req.body as {
        recipientEmail?: string;
        subject?: string;
        sentDateTime?: string;
        message?: string;
        scheduledAt?: string;
      };

      if (!recipientEmail) throw new ValidationError('recipientEmail is required');
      if (!subject) throw new ValidationError('subject is required');
      if (!sentDateTime || isNaN(Date.parse(sentDateTime))) throw new ValidationError('sentDateTime (ISO date) is required');
      if (!message?.trim()) throw new ValidationError('message is required');
      if (scheduledAt && isNaN(Date.parse(scheduledAt))) throw new ValidationError('scheduledAt must be a valid ISO date');

      const alreadyResponded = await prisma.followUp.findFirst({
        where: { userId: currentUser.id, recipientEmail: { equals: recipientEmail, mode: 'insensitive' }, status: 'RESPONDED' },
      });
      if (alreadyResponded) {
        throw new AppError('This person already replied — refusing to send another follow-up.', 422, 'ALREADY_RESPONDED');
      }

      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      const isFutureSchedule = scheduledDate && scheduledDate.getTime() > Date.now() + 5000;

      if (isFutureSchedule) {
        await scheduleFollowUpSend(
          {
            followUpId: null,
            userId: currentUser.id,
            provider: 'OUTLOOK',
            recipientEmail,
            originalSubject: subject,
            originalSentAtIso: sentDateTime,
            message,
          },
          scheduledDate!
        );
        logger.info('Sent-log follow-up scheduled', { userId: currentUser.id, recipientEmail, scheduledAt: scheduledDate!.toISOString() });
        res.json({ success: true, data: { scheduled: true, scheduledAt: scheduledDate!.toISOString() } });
        return;
      }

      const firstName = guessFirstName(null, recipientEmail);
      const company = guessCompany(recipientEmail);

      await sendFollowUp({
        userId: currentUser.id,
        provider: 'OUTLOOK',
        to: recipientEmail,
        originalSubject: subject,
        originalSentAtIso: sentDateTime,
        replyBody: applyFollowUpTemplate(message, firstName, company),
      });

      logger.info('Sent-log follow-up sent', { userId: currentUser.id, recipientEmail });

      res.json({ success: true, data: { scheduled: false, message: 'Follow-up sent' } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/sent-log/bulk-send — sends the same follow-up message threaded to multiple sent-log entries
sentLogRouter.post(
  '/bulk-send',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { entries, message, scheduledAt } = req.body as {
        entries?: Array<{ recipientEmail: string; subject: string; sentDateTime: string }>;
        message?: string;
        scheduledAt?: string;
      };

      if (!Array.isArray(entries) || entries.length === 0) throw new ValidationError('entries (non-empty array) is required');
      if (entries.length > 200) throw new ValidationError('Maximum 200 follow-ups per bulk send');
      if (!message?.trim()) throw new ValidationError('message is required');
      if (scheduledAt && isNaN(Date.parse(scheduledAt))) throw new ValidationError('scheduledAt must be a valid ISO date');
      const followUpMessage: string = message;

      const respondedRows = await prisma.followUp.findMany({
        where: {
          userId: currentUser.id,
          status: 'RESPONDED',
          recipientEmail: { in: entries.map((e) => e.recipientEmail), mode: 'insensitive' },
        },
        select: { recipientEmail: true },
      });
      const respondedEmails = new Set(respondedRows.map((r) => r.recipientEmail.toLowerCase()));

      const eligibleEntries = entries.filter((e) => !respondedEmails.has(e.recipientEmail.toLowerCase()));
      const skippedResponded = entries
        .filter((e) => respondedEmails.has(e.recipientEmail.toLowerCase()))
        .map((e) => ({ recipientEmail: e.recipientEmail, success: false, error: 'Already responded — skipped' }));

      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      const isFutureSchedule = scheduledDate && scheduledDate.getTime() > Date.now() + 5000;

      if (isFutureSchedule) {
        const results: Array<{ recipientEmail: string; success: boolean; error?: string }> = [...skippedResponded];
        for (const entry of eligibleEntries) {
          await scheduleFollowUpSend(
            {
              followUpId: null,
              userId: currentUser.id,
              provider: 'OUTLOOK',
              recipientEmail: entry.recipientEmail,
              originalSubject: entry.subject,
              originalSentAtIso: entry.sentDateTime,
              message: followUpMessage,
            },
            scheduledDate!
          );
          results.push({ recipientEmail: entry.recipientEmail, success: true });
        }

        logger.info('Sent-log bulk follow-up scheduled', { userId: currentUser.id, count: results.length, scheduledAt: scheduledDate!.toISOString() });
        res.json({ success: true, data: { scheduled: true, sent: 0, failed: 0, results } });
        return;
      }

      const results: Array<{ recipientEmail: string; success: boolean; error?: string }> = [...skippedResponded];

      const CONCURRENCY = 3;
      let cursor = 0;

      async function worker() {
        while (cursor < eligibleEntries.length) {
          const entry = eligibleEntries[cursor++];
          try {
            const firstName = guessFirstName(null, entry.recipientEmail);
            const company = guessCompany(entry.recipientEmail);

            await sendFollowUp({
              userId: currentUser.id,
              provider: 'OUTLOOK',
              to: entry.recipientEmail,
              originalSubject: entry.subject,
              originalSentAtIso: entry.sentDateTime,
              replyBody: applyFollowUpTemplate(followUpMessage, firstName, company),
            });
            results.push({ recipientEmail: entry.recipientEmail, success: true });
          } catch (err: any) {
            results.push({ recipientEmail: entry.recipientEmail, success: false, error: err?.message ?? 'Send failed' });
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, eligibleEntries.length) }, worker));

      const sentCount = results.filter((r) => r.success).length;
      const failed = results.length - sentCount;

      logger.info('Sent-log bulk follow-up completed', { userId: currentUser.id, sentCount, failed });

      res.json({ success: true, data: { scheduled: false, sent: sentCount, failed, results } });
    } catch (err) {
      next(err);
    }
  }
);
