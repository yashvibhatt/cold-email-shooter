import { z } from 'zod';

// ─── Email job row from parsed file ──────────────────────────────────────────

export const emailRowSchema = z.object({
  recipient_email: z
    .string()
    .min(1, 'recipient_email is required')
    .email('Invalid email address'),
  subject: z.string().min(1, 'subject is required').max(998, 'subject too long'),
  body: z.string().min(1, 'body is required'),
  send_date: z
    .string()
    .min(1, 'send_date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'send_date must be YYYY-MM-DD'),
  send_time: z
    .string()
    .min(1, 'send_time is required')
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'send_time must be HH:MM or HH:MM:SS'),
  timezone: z.string().optional().default('UTC'),
  status: z.string().optional(),
});

export type EmailRow = z.infer<typeof emailRowSchema>;

// ─── Schedule request ─────────────────────────────────────────────────────────

export const scheduleEmailsSchema = z.object({
  rows: z
    .array(emailRowSchema)
    .min(1, 'At least one email row is required')
    .max(500, 'Maximum 500 emails per batch'),
  sourceFileId: z.string().optional(),
  timezone: z.string().optional().default('UTC'),
});

export type ScheduleEmailsInput = z.infer<typeof scheduleEmailsSchema>;

// ─── Query filters ────────────────────────────────────────────────────────────

export const emailFiltersSchema = z.object({
  status: z
    .enum(['PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED'])
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('20').transform(Number),
});

export type EmailFilters = z.infer<typeof emailFiltersSchema>;

// ─── Required CSV/Excel columns ───────────────────────────────────────────────

export const REQUIRED_COLUMNS = [
  'recipient_email',
  'subject',
  'body',
  'send_date',
  'send_time',
] as const;

export function validateColumns(headers: string[]): string[] {
  const lower = headers.map((h) => h.toLowerCase().trim());
  return REQUIRED_COLUMNS.filter((col) => !lower.includes(col));
}

// ─── Custom error classes ─────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}
