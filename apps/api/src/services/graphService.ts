import 'isomorphic-fetch';
import fs from 'fs';
import path from 'path';
import { Client } from '@microsoft/microsoft-graph-client';
import { getValidAccessToken } from './tokenService';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';

function buildGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

export interface SendMailParams {
  userId: string;
  to: string;
  subject: string;
  body: string;
  attachmentIds?: string[];
}

async function loadAttachments(attachmentIds: string[]): Promise<{
  '@odata.type': string;
  name: string;
  contentType: string;
  contentBytes: string;
}[]> {
  if (!attachmentIds.length) return [];

  const records = await prisma.attachment.findMany({
    where: { id: { in: attachmentIds } },
  });

  const result = [];
  for (const rec of records) {
    const filePath = path.join(env.UPLOAD_DIR, rec.storedName);
    if (!fs.existsSync(filePath)) {
      logger.warn('Attachment file missing on disk, skipping', { attachmentId: rec.id, storedName: rec.storedName });
      continue;
    }
    const contentBytes = fs.readFileSync(filePath).toString('base64');
    result.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: rec.originalName,
      contentType: rec.mimeType,
      contentBytes,
    });
  }
  return result;
}

/**
 * Sends an email via Microsoft Graph API (or logs it in SAFE_MODE).
 */
export async function sendMailViaGraph(params: SendMailParams): Promise<void> {
  const { userId, to, subject, body, attachmentIds = [] } = params;

  if (env.SAFE_MODE) {
    logger.info('[SAFE_MODE] Email not sent – would have sent:', {
      to,
      subject,
      bodyPreview: body.substring(0, 100),
      attachments: attachmentIds.length,
    });
    return;
  }

  const accessToken = await getValidAccessToken(userId);
  const client = buildGraphClient(accessToken);
  const attachments = await loadAttachments(attachmentIds);

  const message = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: body.replace(/\r?\n/g, '<br>'),
      },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    saveToSentItems: true,
  };

  await client.api('/me/sendMail').post(message);
  logger.info('Email sent via Graph API', { userId, to, subject, attachments: attachments.length });
}

/**
 * Fetches the authenticated user's profile from Graph API.
 */
export async function getGraphUserProfile(accessToken: string): Promise<{
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}> {
  const client = buildGraphClient(accessToken);
  return client.api('/me').select('id,displayName,mail,userPrincipalName').get();
}

export interface OutreachCheckResult {
  email: string;
  alreadyContacted: boolean;
  lastContactDate: string | null;
  lastSubject: string | null;
  matchCount: number;
  error?: string;
}

// Graph KQL search doesn't tolerate raw quotes in the query string
function escapeForKqlSearch(value: string): string {
  return value.replace(/"/g, '');
}

async function checkOneRecipient(
  client: Client,
  email: string
): Promise<OutreachCheckResult> {
  const safeEmail = escapeForKqlSearch(email);

  const withRetry = async <T>(fn: () => Promise<T>, attempt = 1): Promise<T> => {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.statusCode ?? err?.status;
      if (status === 429 && attempt <= 3) {
        const retryAfterSec = Number(err?.headers?.get?.('retry-after')) || attempt * 2;
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
        return withRetry(fn, attempt + 1);
      }
      throw err;
    }
  };

  try {
    const res = await withRetry(() =>
      client
        .api('/me/mailFolders/sentitems/messages')
        .search(`"to:${safeEmail}"`)
        .select('subject,sentDateTime,toRecipients')
        .top(5)
        .get()
    );

    const messages = (res?.value ?? []) as Array<{ subject?: string; sentDateTime?: string }>;
    // Graph's $search is a fuzzy match — confirm the recipient actually appears in toRecipients
    const confirmed = messages.filter((m: any) =>
      (m.toRecipients ?? []).some(
        (r: any) => r?.emailAddress?.address?.toLowerCase() === email.toLowerCase()
      )
    );

    if (confirmed.length === 0) {
      return { email, alreadyContacted: false, lastContactDate: null, lastSubject: null, matchCount: 0 };
    }

    const sorted = confirmed.sort(
      (a: any, b: any) => new Date(b.sentDateTime).getTime() - new Date(a.sentDateTime).getTime()
    );

    return {
      email,
      alreadyContacted: true,
      lastContactDate: sorted[0].sentDateTime ?? null,
      lastSubject: sorted[0].subject ?? null,
      matchCount: confirmed.length,
    };
  } catch (err: any) {
    logger.warn('Outreach check failed for recipient', { email, error: err?.message });
    return {
      email,
      alreadyContacted: false,
      lastContactDate: null,
      lastSubject: null,
      matchCount: 0,
      error: err?.message ?? 'Lookup failed',
    };
  }
}

/**
 * Checks each email address against the user's Outlook Sent Items to see if
 * they've already been outreached to. Runs with limited concurrency to avoid
 * Graph API throttling.
 */
export async function checkOutreachHistory(
  accessToken: string,
  emails: string[]
): Promise<OutreachCheckResult[]> {
  const client = buildGraphClient(accessToken);
  const uniqueEmails = Array.from(new Set(emails.map((e) => e.trim().toLowerCase())));

  const CONCURRENCY = 3;
  const results: OutreachCheckResult[] = new Array(uniqueEmails.length);
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueEmails.length) {
      const i = cursor++;
      results[i] = await checkOneRecipient(client, uniqueEmails[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniqueEmails.length) }, worker));
  return results;
}

// ─── Bounce / NDR detection ────────────────────────────────────────────────────

export interface BounceNotification {
  messageId: string;
  bounceSubject: string;
  bounceReceivedAt: string;
  fromAddress: string;
  fromName: string;
  source: 'Mail Delivery Subsystem' | 'Other';
  failedRecipient: string | null;
  reason: string;
}

const MAIL_DAEMON_RE = /mailer-daemon|mail delivery subsystem|mail delivery system/i;

function classifyBounceSource(fromAddress: string, fromName: string): 'Mail Delivery Subsystem' | 'Other' {
  return MAIL_DAEMON_RE.test(fromAddress) || MAIL_DAEMON_RE.test(fromName) ? 'Mail Delivery Subsystem' : 'Other';
}

const BOUNCE_SUBJECT_RE =
  /^(undeliverable|delivery has failed|delivery status notification \(failure\)|mail delivery failed|returned mail|non-delivery report|message (could not be delivered|delayed)|delivery incomplete)/i;

const BOUNCE_SENDER_RE = /(postmaster|mailer-daemon|mail delivery|microsoftexchange|delivery.*subsystem)/i;

const REASON_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /5\.1\.1|user unknown|recipient.*not found|address.*rejected|mailbox unavailable/i, label: 'Mailbox not found' },
  { re: /5\.7\.\d|blocked|spam|reputation|denied/i, label: 'Blocked / spam-filtered' },
  { re: /5\.2\.2|quota exceeded|mailbox full/i, label: 'Mailbox full' },
  { re: /5\.4\.\d|dns|host.*not found|domain.*not found/i, label: 'Domain / DNS failure' },
  { re: /4\.\d\.\d/i, label: 'Temporary failure (retrying)' },
];

function isBounceMessage(subject: string, fromAddress: string): boolean {
  return BOUNCE_SUBJECT_RE.test(subject.trim()) || BOUNCE_SENDER_RE.test(fromAddress);
}

function extractFailedRecipient(subject: string, bodyText: string, ownAddress: string): string | null {
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const candidates = (bodyText.match(emailRe) ?? []).filter((e) => {
    const lower = e.toLowerCase();
    return (
      lower !== ownAddress.toLowerCase() &&
      !/postmaster|mailer-daemon|no-?reply|microsoft\.com|outlook\.com$/i.test(lower)
    );
  });
  if (candidates.length > 0) return candidates[0].toLowerCase();

  // Fall back to stripping the NDR prefix off the subject, in case the
  // original subject line contained the address (rare, but happens)
  const fromSubject = subject.match(emailRe);
  return fromSubject?.[0]?.toLowerCase() ?? null;
}

function extractReason(bodyText: string): string {
  for (const { re, label } of REASON_PATTERNS) {
    if (re.test(bodyText)) return label;
  }
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 140) || 'Unknown delivery failure';
}

function stripBounceSubjectPrefix(subject: string): string {
  return subject.replace(BOUNCE_SUBJECT_RE, '').replace(/^[:\s-]+/, '').trim();
}

/**
 * Scans the user's Inbox for bounce / non-delivery reports (NDRs) received
 * since the given date, and extracts which recipient failed and why.
 */
export async function getBounceNotifications(
  accessToken: string,
  ownAddress: string,
  sinceIso: string
): Promise<BounceNotification[]> {
  const client = buildGraphClient(accessToken);
  const results: BounceNotification[] = [];

  let url: string | undefined =
    `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview,body&$top=50&$orderby=receivedDateTime desc`;

  let pages = 0;
  while (url && pages < 10) {
    pages++;
    const res: any = await client.api(url).get();
    const messages: any[] = res?.value ?? [];

    for (const msg of messages) {
      const subject = msg.subject ?? '';
      const fromAddress = msg.from?.emailAddress?.address ?? '';
      const fromName = msg.from?.emailAddress?.name ?? '';

      if (!isBounceMessage(subject, fromAddress)) continue;

      const bodyText: string = msg.body?.content
        ? msg.body.content.replace(/<[^>]+>/g, ' ')
        : msg.bodyPreview ?? '';

      results.push({
        messageId: msg.id,
        bounceSubject: subject,
        bounceReceivedAt: msg.receivedDateTime,
        fromAddress,
        fromName,
        source: classifyBounceSource(fromAddress, fromName),
        failedRecipient: extractFailedRecipient(subject, bodyText, ownAddress),
        reason: extractReason(bodyText),
      });
    }

    url = res?.['@odata.nextLink']
      ? res['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '')
      : undefined;
  }

  return results;
}

export { stripBounceSubjectPrefix };

// ─── Detecting manually-sent follow-ups (sent outside the app) ────────────────

export interface ManualFollowUpCheck {
  count: number;
  lastSentAt: string | null;
}

const withRetry429 = async <T>(fn: () => Promise<T>, attempt = 1): Promise<T> => {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status;
    if (status === 429 && attempt <= 3) {
      const retryAfterSec = Number(err?.headers?.get?.('retry-after')) || attempt * 2;
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
      return withRetry429(fn, attempt + 1);
    }
    throw err;
  }
};

/**
 * Counts how many times the user sent something to this recipient after the
 * original campaign email — catches follow-ups sent by replying directly in
 * Outlook instead of through the app.
 */
async function countManualFollowUpsSent(
  client: Client,
  recipientEmail: string,
  originalSentAtIso: string
): Promise<ManualFollowUpCheck> {
  const safeEmail = escapeForKqlSearch(recipientEmail);

  try {
    const res: any = await withRetry429(() =>
      client
        .api('/me/mailFolders/sentitems/messages')
        .search(`"to:${safeEmail}"`)
        .select('sentDateTime,toRecipients')
        .top(15)
        .get()
    );

    const messages: any[] = res?.value ?? [];
    const originalTime = new Date(originalSentAtIso).getTime();

    const followUpsSentByUser = messages.filter((m) => {
      const matchesRecipient = (m.toRecipients ?? []).some(
        (r: any) => r?.emailAddress?.address?.toLowerCase() === recipientEmail.toLowerCase()
      );
      const sentTime = new Date(m.sentDateTime).getTime();
      return matchesRecipient && sentTime > originalTime;
    });

    if (followUpsSentByUser.length === 0) return { count: 0, lastSentAt: null };

    const latest = followUpsSentByUser.sort(
      (a, b) => new Date(b.sentDateTime).getTime() - new Date(a.sentDateTime).getTime()
    )[0];

    return { count: followUpsSentByUser.length, lastSentAt: latest.sentDateTime };
  } catch (err: any) {
    logger.warn('Manual follow-up check failed', { recipientEmail, error: err?.message });
    return { count: 0, lastSentAt: null };
  }
}

/**
 * Checks each given recipient's Sent Items for manually-sent follow-ups
 * (i.e. sent by replying directly in Outlook, not through this app).
 * Runs with limited concurrency to avoid Graph API throttling.
 */
export async function detectManualFollowUps(
  accessToken: string,
  items: Array<{ recipientEmail: string; originalSentAtIso: string }>
): Promise<Map<string, ManualFollowUpCheck>> {
  const client = buildGraphClient(accessToken);
  const results = new Map<string, ManualFollowUpCheck>();

  const CONCURRENCY = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const result = await countManualFollowUpsSent(client, item.recipientEmail, item.originalSentAtIso);
      results.set(item.recipientEmail.toLowerCase(), result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

// ─── Sent Items scan by date range ─────────────────────────────────────────────

export interface SentMessageEntry {
  recipientEmail: string;
  subject: string;
  sentDateTime: string;
}

/**
 * Scans Outlook Sent Items for all messages sent within [sinceIso, untilIso).
 * Used to build a "what did I send on this date" report — catches messages
 * sent manually (outside this app) too, unlike the local EmailJob table.
 */
export async function getSentMessagesInRange(
  accessToken: string,
  sinceIso: string,
  untilIso: string
): Promise<SentMessageEntry[]> {
  const client = buildGraphClient(accessToken);
  const results: SentMessageEntry[] = [];

  const filter = `sentDateTime ge ${sinceIso} and sentDateTime lt ${untilIso}`;
  let url: string | undefined =
    `/me/mailFolders/sentitems/messages?$filter=${encodeURIComponent(filter)}` +
    `&$select=subject,sentDateTime,toRecipients&$top=100&$orderby=sentDateTime desc`;

  let pages = 0;
  while (url && pages < 20) {
    pages++;
    const res: any = await withRetry429(() => client.api(url!).get());
    const messages: any[] = res?.value ?? [];

    for (const msg of messages) {
      const subject = msg.subject ?? '';
      const sentDateTime = msg.sentDateTime;
      for (const recipient of msg.toRecipients ?? []) {
        const address = recipient?.emailAddress?.address;
        if (address) results.push({ recipientEmail: address, subject, sentDateTime });
      }
    }

    url = res?.['@odata.nextLink']
      ? res['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '')
      : undefined;
  }

  return results;
}

// ─── Threaded follow-up replies ────────────────────────────────────────────────

/**
 * Locates the original sent message to a recipient (closest subject + time
 * match) so a follow-up can be sent as a proper threaded reply.
 */
async function findOriginalSentMessage(
  client: Client,
  recipientEmail: string,
  originalSubject: string,
  originalSentAtIso: string
): Promise<{ id: string } | null> {
  const safeEmail = escapeForKqlSearch(recipientEmail);
  const res: any = await client
    .api('/me/mailFolders/sentitems/messages')
    .search(`"to:${safeEmail}"`)
    .select('id,subject,sentDateTime,toRecipients')
    .top(10)
    .get();

  const messages: any[] = res?.value ?? [];
  const confirmed = messages.filter((m) =>
    (m.toRecipients ?? []).some(
      (r: any) => r?.emailAddress?.address?.toLowerCase() === recipientEmail.toLowerCase()
    )
  );

  if (confirmed.length === 0) return null;

  const exactSubject = confirmed.find((m) => (m.subject ?? '').trim() === originalSubject.trim());
  if (exactSubject) return { id: exactSubject.id };

  // Fall back to whichever sent message is closest in time to the recorded send
  const targetTime = new Date(originalSentAtIso).getTime();
  const closest = confirmed.sort(
    (a, b) =>
      Math.abs(new Date(a.sentDateTime).getTime() - targetTime) -
      Math.abs(new Date(b.sentDateTime).getTime() - targetTime)
  )[0];

  return { id: closest.id };
}

export interface FollowUpAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export interface SendFollowUpParams {
  accessToken: string;
  recipientEmail: string;
  originalSubject: string;
  originalSentAtIso: string;
  replyBodyHtml: string;
  attachments?: FollowUpAttachment[];
}

/**
 * Sends a follow-up as a threaded reply to the original sent message
 * (same conversation, "RE:" subject, quoted history preserved).
 * Throws if the original message can't be located in Sent Items.
 */
export async function sendThreadedFollowUp(params: SendFollowUpParams): Promise<void> {
  const { accessToken, recipientEmail, originalSubject, originalSentAtIso, replyBodyHtml, attachments = [] } = params;
  const client = buildGraphClient(accessToken);

  const original = await findOriginalSentMessage(client, recipientEmail, originalSubject, originalSentAtIso);
  if (!original) {
    throw new Error(
      `Could not find the original email to ${recipientEmail} in Sent Items — it may be outside the mailbox's retention window.`
    );
  }

  const draft: any = await client.api(`/me/messages/${original.id}/createReply`).post({});

  // Graph's createReply mirrors "reply to sender" based on the original
  // message's From field — since we sent the original ourselves, that
  // defaults the recipient back to us. Override it explicitly to the
  // person we actually sent the campaign to.
  await client.api(`/me/messages/${draft.id}`).patch({
    toRecipients: [{ emailAddress: { address: recipientEmail } }],
    ccRecipients: [],
    body: { contentType: 'HTML', content: replyBodyHtml },
  });

  for (const att of attachments) {
    await client.api(`/me/messages/${draft.id}/attachments`).post({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.filename,
      contentType: att.mimeType,
      contentBytes: att.contentBase64,
    });
  }

  await client.api(`/me/messages/${draft.id}/send`).post({});
}

// ─── Reply / out-of-office detection ───────────────────────────────────────────

export interface InboxReply {
  fromAddress: string;
  subject: string;
  receivedAt: string;
  isOutOfOffice: boolean;
  oooNote: string | null;
  oooReturnDate: string | null;
  replyPreview: string | null;
}

const OOO_RE = /(out of (the )?office|automatic reply|auto-?reply|on (annual )?leave|on vacation|currently unavailable|away from (my )?(desk|email|office)|will be back|out sick|maternity leave|paternity leave)/i;

// Matches things like "back on Monday, July 21", "return on 07/21/2026", "until August 3rd", "back in office August 3"
const RETURN_DATE_RE =
  /(?:back|return(?:ing)?|available)\s*(?:on|in office on|to (?:the )?office (?:on)?)?\s*((?:\w+day,?\s*)?(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/i;

function isOutOfOfficeMessage(subject: string, bodyText: string, headers: Array<{ name: string; value: string }> | undefined): boolean {
  const autoSubmitted = headers?.find((h) => h.name.toLowerCase() === 'auto-submitted');
  if (autoSubmitted && /auto-replied/i.test(autoSubmitted.value)) return true;

  return OOO_RE.test(subject) || OOO_RE.test(bodyText.slice(0, 500));
}

function extractOooReturnDate(bodyText: string): string | null {
  const match = bodyText.match(RETURN_DATE_RE);
  if (!match) return null;

  // Strip ordinal suffixes ("20th" -> "20") and weekday prefixes — native Date
  // parsing chokes on "July 20th" but handles "July 20" fine.
  let dateStr = match[1].replace(/(\d+)(st|nd|rd|th)/gi, '$1').replace(/^\w+day,?\s*/i, '').trim();

  // No year given (e.g. "July 20") — native parsing defaults to 2001 in some
  // engines, so pin it to the current year explicitly.
  if (!/\d{4}/.test(dateStr)) {
    dateStr = `${dateStr}, ${new Date().getFullYear()}`;
  }

  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractOooNote(bodyText: string): string {
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Scans the user's Inbox for any replies received since the given date and
 * classifies each as an out-of-office auto-reply or a genuine human reply.
 * Does not attempt to match replies to specific sent campaigns — that's done
 * by the caller, keyed on fromAddress.
 */
export async function getInboxReplies(accessToken: string, sinceIso: string): Promise<InboxReply[]> {
  const client = buildGraphClient(accessToken);
  const results: InboxReply[] = [];

  let url: string | undefined =
    `/me/mailFolders/inbox/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
    `&$select=subject,from,receivedDateTime,bodyPreview,body,internetMessageHeaders&$top=50&$orderby=receivedDateTime desc`;

  let pages = 0;
  while (url && pages < 15) {
    pages++;
    const res: any = await client.api(url).get();
    const messages: any[] = res?.value ?? [];

    for (const msg of messages) {
      const subject = msg.subject ?? '';
      const fromAddress = msg.from?.emailAddress?.address ?? '';
      if (!fromAddress) continue;

      const bodyText: string = msg.body?.content
        ? msg.body.content.replace(/<[^>]+>/g, ' ')
        : msg.bodyPreview ?? '';

      const isOoo = isOutOfOfficeMessage(subject, bodyText, msg.internetMessageHeaders);

      results.push({
        fromAddress,
        subject,
        receivedAt: msg.receivedDateTime,
        isOutOfOffice: isOoo,
        oooNote: isOoo ? extractOooNote(bodyText) : null,
        oooReturnDate: isOoo ? extractOooReturnDate(bodyText) : null,
        replyPreview: extractOooNote(bodyText) || null,
      });
    }

    url = res?.['@odata.nextLink']
      ? res['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '')
      : undefined;
  }

  return results;
}
