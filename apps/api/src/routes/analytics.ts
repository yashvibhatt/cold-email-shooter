import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { getValidAccessToken } from '../services/tokenService';
import { getBounceNotifications, stripBounceSubjectPrefix } from '../services/graphService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const analyticsRouter = Router();

// GET /api/analytics/bounces?since=ISO_DATE — scans Inbox for NDRs and matches them to sent campaigns
analyticsRouter.get(
  '/bounces',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam && !isNaN(Date.parse(sinceParam))
        ? new Date(sinceParam)
        : new Date(new Date().setHours(0, 0, 0, 0)); // default: start of today

      const accessToken = await getValidAccessToken(currentUser.id);
      const bounces = await getBounceNotifications(accessToken, currentUser.email, since.toISOString());

      // Match each bounce to the most recent SENT job for that recipient, for context
      const recipientEmails = Array.from(
        new Set(bounces.map((b) => b.failedRecipient).filter(Boolean) as string[])
      );

      const sentJobs = recipientEmails.length
        ? await prisma.emailJob.findMany({
            where: {
              userId: currentUser.id,
              status: 'SENT',
              recipientEmail: { in: recipientEmails, mode: 'insensitive' },
            },
            orderBy: { sentAt: 'desc' },
            select: { id: true, recipientEmail: true, subject: true, sentAt: true },
          })
        : [];

      const jobByEmail = new Map<string, (typeof sentJobs)[number]>();
      for (const job of sentJobs) {
        const key = job.recipientEmail.toLowerCase();
        if (!jobByEmail.has(key)) jobByEmail.set(key, job); // first = most recent (already ordered)
      }

      const results = bounces.map((b) => {
        const matched = b.failedRecipient ? jobByEmail.get(b.failedRecipient) : undefined;
        return {
          recipientEmail: b.failedRecipient,
          reason: b.reason,
          bounceSubject: b.bounceSubject,
          bounceReceivedAt: b.bounceReceivedAt,
          source: b.source,
          fromAddress: b.fromAddress,
          originalSubject: matched?.subject ?? stripBounceSubjectPrefix(b.bounceSubject) ?? null,
          originalSentAt: matched?.sentAt ?? null,
          matchedEmailJobId: matched?.id ?? null,
        };
      });

      // Total sent today (for bounce-rate context), independent of the bounce scan
      const totalSentSince = await prisma.emailJob.count({
        where: { userId: currentUser.id, status: 'SENT', sentAt: { gte: since } },
      });

      logger.info('Bounce scan completed', {
        userId: currentUser.id,
        since: since.toISOString(),
        bounces: results.length,
        totalSentSince,
      });

      res.json({
        success: true,
        data: {
          since: since.toISOString(),
          totalSentSince,
          totalBounced: results.length,
          bounceRate: totalSentSince > 0 ? results.length / totalSentSince : 0,
          bounces: results,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
