import { Router, Request, Response, NextFunction } from 'express';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { parseISO, isValid } from 'date-fns';
import { EmailStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { scheduleEmailJob } from '../queues/emailQueue';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import {
  scheduleEmailsSchema,
  emailFiltersSchema,
  ValidationError,
  NotFoundError,
  AppError,
} from '../utils/validation';
import { buildIdempotencyKey } from '../utils/idempotency';
import { sendMail } from '../services/mailService';
import { logger } from '../utils/logger';

export const emailsRouter = Router();

// ─── GET /api/emails/stats ────────────────────────────────────────────────────
emailsRouter.get(
  '/stats',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const [counts, nextEmail] = await Promise.all([
        prisma.emailJob.groupBy({
          by: ['status'],
          where: { userId: currentUser.id },
          _count: { id: true },
        }),
        prisma.emailJob.findFirst({
          where: {
            userId: currentUser.id,
            status: EmailStatus.SCHEDULED,
            scheduledDatetime: { gte: new Date() },
          },
          orderBy: { scheduledDatetime: 'asc' },
          select: {
            id: true,
            recipientEmail: true,
            subject: true,
            scheduledDatetime: true,
            timezone: true,
          },
        }),
      ]);

      const stats = {
        total: 0,
        pending: 0,
        scheduled: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
      };

      for (const row of counts) {
        const key = row.status.toLowerCase() as keyof typeof stats;
        stats[key] = row._count.id;
        stats.total += row._count.id;
      }

      res.json({ success: true, data: { stats, nextEmail } });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/emails ──────────────────────────────────────────────────────────
emailsRouter.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const filters = emailFiltersSchema.parse(req.query);

      const where: Record<string, unknown> = { userId: currentUser.id };

      if (filters.status) where.status = filters.status;
      if (filters.dateFrom || filters.dateTo) {
        where.scheduledDatetime = {
          ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
          ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
        };
      }

      const [total, emails] = await Promise.all([
        prisma.emailJob.count({ where }),
        prisma.emailJob.findMany({
          where,
          orderBy: { scheduledDatetime: 'asc' },
          skip: (filters.page - 1) * filters.limit,
          take: filters.limit,
          include: {
            sourceFile: { select: { id: true, originalName: true } },
            sendLogs: {
              orderBy: { createdAt: 'desc' },
              take: 3,
            },
          },
        }),
      ]);

      res.json({
        success: true,
        data: {
          emails,
          pagination: {
            total,
            page: filters.page,
            limit: filters.limit,
            totalPages: Math.ceil(total / filters.limit),
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/emails/schedule ────────────────────────────────────────────────
emailsRouter.post(
  '/schedule',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const input = scheduleEmailsSchema.parse(req.body);

      const results: {
        success: boolean;
        recipientEmail: string;
        emailJobId?: string;
        error?: string;
        duplicate?: boolean;
      }[] = [];

      let scheduled = 0;
      let duplicates = 0;
      let errors = 0;

      for (const row of input.rows) {
        try {
          // Build UTC datetime from date + time + timezone
          const localDatetimeStr = `${row.send_date}T${row.send_time.length === 5 ? row.send_time + ':00' : row.send_time}`;
          const timezone = row.timezone || input.timezone || 'UTC';

          let scheduledDatetime: Date;
          try {
            scheduledDatetime = fromZonedTime(localDatetimeStr, timezone);
          } catch {
            throw new ValidationError(`Invalid date/time or timezone: ${localDatetimeStr} (${timezone})`);
          }

          if (!isValid(scheduledDatetime)) {
            throw new ValidationError(`Invalid scheduled datetime: ${localDatetimeStr}`);
          }

          const idempotencyKey = buildIdempotencyKey({
            userId: currentUser.id,
            recipientEmail: row.recipient_email,
            subject: row.subject,
            scheduledDatetime,
          });

          // Check for duplicate
          const existing = await prisma.emailJob.findUnique({ where: { idempotencyKey } });
          if (existing) {
            duplicates++;
            results.push({
              success: false,
              recipientEmail: row.recipient_email,
              emailJobId: existing.id,
              duplicate: true,
              error: 'Duplicate: already scheduled',
            });
            continue;
          }

          const emailJob = await prisma.emailJob.create({
            data: {
              userId: currentUser.id,
              recipientEmail: row.recipient_email,
              subject: row.subject,
              body: row.body,
              scheduledDatetime,
              timezone: row.timezone || input.timezone || 'UTC',
              status: EmailStatus.SCHEDULED,
              provider: input.provider,
              sourceFileId: input.sourceFileId ?? null,
              idempotencyKey,
              attachmentIds: (req.body.attachmentIds ?? []) as string[],
            },
          });

          await scheduleEmailJob(emailJob.id, currentUser.id, scheduledDatetime);

          scheduled++;
          results.push({
            success: true,
            recipientEmail: row.recipient_email,
            emailJobId: emailJob.id,
          });
        } catch (rowErr) {
          errors++;
          const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
          results.push({
            success: false,
            recipientEmail: row.recipient_email ?? 'unknown',
            error: msg,
          });
          logger.warn('Failed to schedule email row', { error: msg });
        }
      }

      logger.info('Batch schedule completed', {
        userId: currentUser.id,
        scheduled,
        duplicates,
        errors,
      });

      res.status(201).json({
        success: true,
        data: { scheduled, duplicates, errors, results },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/emails/schedule-campaign ──────────────────────────────────────
// Takes contacts list + subject/body template + date/time/stagger → schedules all
emailsRouter.post(
  '/schedule-campaign',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const {
        contacts,
        subject,
        body,
        startDate,
        startTime,
        timezone = 'UTC',
        staggerMinutes = 0,
        sourceFileId,
        attachmentIds = [],
        provider = 'OUTLOOK',
      } = req.body as {
        contacts: Array<{ email: string; firstName: string; lastName: string; fullName: string; company: string; title: string; location?: string }>;
        subject: string;
        body: string;
        startDate: string;
        startTime: string;
        timezone?: string;
        staggerMinutes?: number;
        sourceFileId?: string;
        attachmentIds?: string[];
        provider?: 'OUTLOOK' | 'GMAIL';
      };

      if (provider !== 'OUTLOOK' && provider !== 'GMAIL') {
        throw new ValidationError('provider must be OUTLOOK or GMAIL');
      }

      if (!contacts?.length) throw new ValidationError('contacts array is required');
      if (!subject?.trim())  throw new ValidationError('subject is required');
      if (!body?.trim())     throw new ValidationError('body is required');
      if (!startDate)        throw new ValidationError('startDate is required (YYYY-MM-DD)');
      if (!startTime)        throw new ValidationError('startTime is required (HH:MM)');

      function applyTemplate(template: string, c: typeof contacts[0]): string {
        return template
          .replace(/\{\{first_name\}\}/gi,  c.firstName || c.fullName || 'there')
          .replace(/\{\{last_name\}\}/gi,   c.lastName  || '')
          .replace(/\{\{full_name\}\}/gi,   c.fullName  || c.firstName || 'there')
          .replace(/\{\{company\}\}/gi,     c.company   || '')
          .replace(/\{\{title\}\}/gi,       c.title     || '')
          .replace(/\{\{location\}\}/gi,    c.location  || '');
      }

      const baseLocalStr = `${startDate}T${startTime.length === 5 ? startTime + ':00' : startTime}`;
      let baseUtc: Date;
      try {
        baseUtc = fromZonedTime(baseLocalStr, timezone);
      } catch {
        throw new ValidationError(`Invalid date/time or timezone: ${baseLocalStr} (${timezone})`);
      }

      const results: Array<{ success: boolean; email: string; emailJobId?: string; error?: string; duplicate?: boolean }> = [];
      let scheduled = 0, duplicates = 0, errors = 0;

      // Warn if the base time is already in the past — jobs will fire immediately
      if (baseUtc.getTime() < Date.now()) {
        logger.warn('Campaign scheduled in the past — jobs will fire immediately', {
          userId: currentUser.id,
          baseUtc: baseUtc.toISOString(),
          inputLocal: baseLocalStr,
          timezone,
        });
      } else {
        logger.info('Campaign scheduled', {
          userId: currentUser.id,
          baseUtc: baseUtc.toISOString(),
          delayMinutes: Math.round((baseUtc.getTime() - Date.now()) / 60000),
        });
      }

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        try {
          const scheduledDatetime = new Date(baseUtc.getTime() + i * staggerMinutes * 60 * 1000);
          const expandedSubject = applyTemplate(subject, contact);
          const expandedBody    = applyTemplate(body, contact);

          const idempotencyKey = buildIdempotencyKey({
            userId: currentUser.id,
            recipientEmail: contact.email,
            subject: expandedSubject,
            scheduledDatetime,
          });

          const existing = await prisma.emailJob.findUnique({ where: { idempotencyKey } });
          if (existing) {
            duplicates++;
            results.push({ success: false, email: contact.email, emailJobId: existing.id, duplicate: true, error: 'Duplicate' });
            continue;
          }

          const emailJob = await prisma.emailJob.create({
            data: {
              userId: currentUser.id,
              recipientEmail: contact.email,
              subject: expandedSubject,
              body: expandedBody,
              scheduledDatetime,
              timezone,
              status: EmailStatus.SCHEDULED,
              provider,
              company: contact.company || null,
              location: contact.location || null,
              sourceFileId: sourceFileId ?? null,
              attachmentIds,
              idempotencyKey,
            },
          });

          await scheduleEmailJob(emailJob.id, currentUser.id, scheduledDatetime);
          scheduled++;
          results.push({ success: true, email: contact.email, emailJobId: emailJob.id });
        } catch (err) {
          errors++;
          results.push({ success: false, email: contact.email, error: err instanceof Error ? err.message : String(err) });
        }
      }

      logger.info('Campaign scheduled', { userId: currentUser.id, scheduled, duplicates, errors });

      res.status(201).json({ success: true, data: { scheduled, duplicates, errors, results } });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/emails/:id ──────────────────────────────────────────────────────
emailsRouter.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const emailJob = await prisma.emailJob.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
        include: {
          sendLogs: { orderBy: { createdAt: 'desc' } },
          sourceFile: true,
        },
      });

      if (!emailJob) throw new NotFoundError('Email job not found');

      res.json({ success: true, data: emailJob });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/emails/:id/cancel ─────────────────────────────────────────────
emailsRouter.patch(
  '/:id/cancel',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const emailJob = await prisma.emailJob.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });

      if (!emailJob) throw new NotFoundError('Email job not found');

      if (emailJob.status === EmailStatus.SENT) {
        throw new AppError('Cannot cancel an already sent email', 422, 'ALREADY_SENT');
      }
      if (emailJob.status === EmailStatus.CANCELLED) {
        throw new AppError('Email is already cancelled', 422, 'ALREADY_CANCELLED');
      }

      const updated = await prisma.emailJob.update({
        where: { id: req.params.id },
        data: { status: EmailStatus.CANCELLED },
      });

      // The BullMQ worker checks status before sending, so no need to remove the job
      // (it will be a no-op when it runs)

      logger.info('Email job cancelled', { emailJobId: req.params.id, userId: currentUser.id });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/emails/:id/retry ───────────────────────────────────────────────
emailsRouter.post(
  '/:id/retry',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const emailJob = await prisma.emailJob.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });

      if (!emailJob) throw new NotFoundError('Email job not found');

      if (emailJob.status !== EmailStatus.FAILED) {
        throw new AppError('Only failed emails can be retried', 422, 'NOT_FAILED');
      }

      await prisma.emailJob.update({
        where: { id: req.params.id },
        data: { status: EmailStatus.SCHEDULED, failedReason: null },
      });

      await scheduleEmailJob(emailJob.id, currentUser.id, new Date());

      res.json({ success: true, data: { message: 'Email queued for retry' } });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/emails/test ────────────────────────────────────────────────────
emailsRouter.post(
  '/test',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const { to, subject, body, attachmentIds = [], provider = 'OUTLOOK' } = req.body;

      if (!to || !subject || !body) {
        throw new ValidationError('to, subject, and body are required for test email');
      }
      if (provider !== 'OUTLOOK' && provider !== 'GMAIL') {
        throw new ValidationError('provider must be OUTLOOK or GMAIL');
      }

      await sendMail({
        userId: currentUser.id,
        to,
        subject,
        body,
        attachmentIds,
        provider,
      });

      res.json({
        success: true,
        data: {
          message: `Test email ${process.env.SAFE_MODE === 'true' ? 'logged (SAFE_MODE active)' : 'sent'} to ${to}`,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/emails/:id ───────────────────────────────────────────────────
emailsRouter.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const emailJob = await prisma.emailJob.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });

      if (!emailJob) throw new NotFoundError('Email job not found');

      if (emailJob.status === EmailStatus.SCHEDULED) {
        throw new AppError('Cancel the email before deleting it', 422, 'MUST_CANCEL_FIRST');
      }

      await prisma.emailJob.delete({ where: { id: req.params.id } });

      res.json({ success: true, data: { message: 'Email job deleted' } });
    } catch (err) {
      next(err);
    }
  }
);
