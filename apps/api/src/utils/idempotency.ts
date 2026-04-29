import crypto from 'crypto';

/**
 * Generates a deterministic idempotency key so the same email cannot be
 * scheduled twice, even across duplicate file uploads.
 */
export function buildIdempotencyKey(params: {
  userId: string;
  recipientEmail: string;
  subject: string;
  scheduledDatetime: Date;
}): string {
  const raw = [
    params.userId,
    params.recipientEmail.toLowerCase().trim(),
    params.subject.trim(),
    params.scheduledDatetime.toISOString(),
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}
