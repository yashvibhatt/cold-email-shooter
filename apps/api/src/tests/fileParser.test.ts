import path from 'path';
import { parseCsvFile } from '../services/fileParser';
import { buildIdempotencyKey } from '../utils/idempotency';
import { validateColumns, emailRowSchema } from '../utils/validation';

describe('fileParser', () => {
  it('parses a valid CSV and returns rows', async () => {
    const csvPath = path.resolve(__dirname, '../../../../test-data/sample-emails.csv');
    const result = await parseCsvFile(csvPath);

    expect(result.totalRows).toBeGreaterThan(0);
    expect(result.validRows).toBeGreaterThan(0);
    // Row with "invalid-email" and missing body should be invalid
    expect(result.invalidRows).toBeGreaterThan(0);
  });
});

describe('validateColumns', () => {
  it('returns missing columns when some are absent', () => {
    const headers = ['recipient_email', 'subject', 'body'];
    const missing = validateColumns(headers);
    expect(missing).toContain('send_date');
    expect(missing).toContain('send_time');
  });

  it('returns empty array when all columns present', () => {
    const headers = ['recipient_email', 'subject', 'body', 'send_date', 'send_time'];
    expect(validateColumns(headers)).toHaveLength(0);
  });
});

describe('emailRowSchema', () => {
  it('rejects invalid email address', () => {
    const result = emailRowSchema.safeParse({
      recipient_email: 'not-an-email',
      subject: 'Hello',
      body: 'Body',
      send_date: '2026-05-01',
      send_time: '09:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = emailRowSchema.safeParse({
      recipient_email: 'test@example.com',
      subject: 'Hello',
      body: 'Body',
      send_date: '01/05/2026', // wrong format
      send_time: '09:00',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid row', () => {
    const result = emailRowSchema.safeParse({
      recipient_email: 'test@example.com',
      subject: 'Hello World',
      body: 'Email body text',
      send_date: '2026-05-01',
      send_time: '09:00',
    });
    expect(result.success).toBe(true);
  });
});

describe('buildIdempotencyKey', () => {
  it('returns the same key for the same inputs', () => {
    const params = {
      userId: 'user_1',
      recipientEmail: 'alice@example.com',
      subject: 'Hello',
      scheduledDatetime: new Date('2026-05-01T09:00:00Z'),
    };
    const k1 = buildIdempotencyKey(params);
    const k2 = buildIdempotencyKey(params);
    expect(k1).toBe(k2);
  });

  it('returns different keys for different scheduled times', () => {
    const base = {
      userId: 'user_1',
      recipientEmail: 'alice@example.com',
      subject: 'Hello',
    };
    const k1 = buildIdempotencyKey({ ...base, scheduledDatetime: new Date('2026-05-01T09:00:00Z') });
    const k2 = buildIdempotencyKey({ ...base, scheduledDatetime: new Date('2026-05-01T10:00:00Z') });
    expect(k1).not.toBe(k2);
  });
});
