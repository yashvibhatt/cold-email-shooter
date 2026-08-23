import { google } from 'googleapis';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function buildOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function isGoogleConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

export function getGoogleLoginUrl(state: string): string {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token on every connect, not just the first time
    scope: SCOPES,
    state,
  });
}

export interface GoogleCallbackResult {
  googleId: string;
  googleEmail: string;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number;
}

export async function handleGoogleCallback(code: string): Promise<GoogleCallbackResult> {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Google did not return an access token');
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();

  if (!profile.id || !profile.email) {
    throw new Error('Could not fetch Google account profile');
  }

  return {
    googleId: profile.id,
    googleEmail: profile.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

/**
 * Returns a valid Gmail access token, refreshing via the stored refresh
 * token when the cached one is within 60 seconds of expiry.
 */
export async function getValidGoogleAccessToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const buffer = 60 * 1000;

  if (
    user.googleAccessToken &&
    user.googleTokenExpiry &&
    user.googleTokenExpiry.getTime() - Date.now() > buffer
  ) {
    return user.googleAccessToken;
  }

  if (!user.googleRefreshToken) {
    throw Object.assign(
      new Error('No Gmail connection found. Please connect Gmail again.'),
      { code: 'AUTH_RELOGIN_REQUIRED' }
    );
  }

  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: user.googleRefreshToken });

  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error('No access token in refresh response');

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: credentials.access_token,
        googleTokenExpiry: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
      },
    });

    logger.info('Google token refreshed', { userId });
    return credentials.access_token;
  } catch (err: any) {
    logger.error('Google token refresh failed', { userId, error: err?.message });
    throw Object.assign(
      new Error('Your Gmail session has expired. Please reconnect Gmail.'),
      { code: 'AUTH_RELOGIN_REQUIRED' }
    );
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface MimeAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

function buildMimeMessage(
  to: string,
  subject: string,
  htmlBody: string,
  attachments: MimeAttachment[],
  extraHeaders: Record<string, string> = {}
): string {
  const boundary = `----=_Boundary_${Date.now()}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

  const headers = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const parts: string[] = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
  ];

  for (const att of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      att.contentBase64
    );
  }

  parts.push(`--${boundary}--`);

  return [...headers, '', ...parts].join('\r\n');
}

export interface SendGmailParams {
  userId: string;
  to: string;
  subject: string;
  body: string;
  attachments?: MimeAttachment[];
}

export async function sendMailViaGmail(params: SendGmailParams): Promise<void> {
  const { userId, to, subject, body, attachments = [] } = params;

  if (env.SAFE_MODE) {
    logger.info('[SAFE_MODE] Gmail not sent – would have sent:', {
      to,
      subject,
      bodyPreview: body.substring(0, 100),
      attachments: attachments.length,
    });
    return;
  }

  const accessToken = await getValidGoogleAccessToken(userId);
  const client = buildOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: client });

  const raw = base64UrlEncode(
    buildMimeMessage(to, subject, body.replace(/\r?\n/g, '<br>'), attachments)
  );

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  logger.info('Email sent via Gmail API', { userId, to, subject, attachments: attachments.length });
}

function decodeHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string | null {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/**
 * Finds the original sent message to a recipient (closest subject + time
 * match) via Gmail search, so a follow-up can be threaded onto it.
 */
async function findOriginalGmailMessage(
  gmail: ReturnType<typeof google.gmail>,
  recipientEmail: string,
  originalSubject: string
): Promise<{ id: string; threadId: string; messageIdHeader: string | null; references: string | null } | null> {
  const escapedSubject = originalSubject.replace(/["\\]/g, '');
  const query = `in:sent to:${recipientEmail} subject:"${escapedSubject}"`;

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 5 });
  const candidates = list.data.messages ?? [];
  if (candidates.length === 0) return null;

  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: candidates[0].id!,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'References'],
  });

  return {
    id: msg.data.id!,
    threadId: msg.data.threadId!,
    messageIdHeader: decodeHeaderValue(msg.data.payload?.headers as any, 'Message-ID'),
    references: decodeHeaderValue(msg.data.payload?.headers as any, 'References'),
  };
}

export interface SendGmailFollowUpParams {
  userId: string;
  to: string;
  originalSubject: string;
  replyBodyHtml: string;
  attachments?: MimeAttachment[];
}

/**
 * Sends a follow-up as a threaded Gmail reply (same thread, "Re:" subject,
 * proper In-Reply-To/References headers so clients render it as a reply).
 * Throws if the original message can't be located via search.
 */
export async function sendThreadedGmailFollowUp(params: SendGmailFollowUpParams): Promise<void> {
  const { userId, to, originalSubject, replyBodyHtml, attachments = [] } = params;

  const accessToken = await getValidGoogleAccessToken(userId);
  const client = buildOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: client });

  const original = await findOriginalGmailMessage(gmail, to, originalSubject);
  if (!original) {
    throw new Error(
      `Could not find the original email to ${to} in Gmail Sent — it may be outside the search window.`
    );
  }

  const replySubject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
  const refs = [original.references, original.messageIdHeader].filter(Boolean).join(' ');

  const raw = base64UrlEncode(
    buildMimeMessage(to, replySubject, replyBodyHtml, attachments, {
      ...(original.messageIdHeader ? { 'In-Reply-To': original.messageIdHeader } : {}),
      ...(refs ? { References: refs } : {}),
    })
  );

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: original.threadId },
  });

  logger.info('Follow-up sent via Gmail API (threaded)', { userId, to, originalSubject });
}
