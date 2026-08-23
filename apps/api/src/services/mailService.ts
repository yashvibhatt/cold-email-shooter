import fs from 'fs';
import path from 'path';
import { EmailProvider } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendMailViaGraph, sendThreadedFollowUp } from './graphService';
import { sendMailViaGmail, sendThreadedGmailFollowUp } from './googleService';
import { getValidAccessToken } from './tokenService';

export interface SendMailParams {
  userId: string;
  to: string;
  subject: string;
  body: string;
  attachmentIds?: string[];
  provider: EmailProvider;
}

async function loadAttachmentFiles(attachmentIds: string[]) {
  if (!attachmentIds.length) return [];

  const records = await prisma.attachment.findMany({ where: { id: { in: attachmentIds } } });
  const result = [];
  for (const rec of records) {
    const filePath = path.join(env.UPLOAD_DIR, rec.storedName);
    if (!fs.existsSync(filePath)) {
      logger.warn('Attachment file missing on disk, skipping', { attachmentId: rec.id, storedName: rec.storedName });
      continue;
    }
    result.push({
      filename: rec.originalName,
      mimeType: rec.mimeType,
      contentBase64: fs.readFileSync(filePath).toString('base64'),
    });
  }
  return result;
}

/**
 * Routes a send request to the correct provider (Outlook or Gmail).
 * Both providers share the same SAFE_MODE / retry semantics at the caller level.
 */
export async function sendMail(params: SendMailParams): Promise<void> {
  const { userId, to, subject, body, attachmentIds = [], provider } = params;

  if (provider === EmailProvider.GMAIL) {
    const attachments = await loadAttachmentFiles(attachmentIds);
    await sendMailViaGmail({ userId, to, subject, body, attachments });
    return;
  }

  await sendMailViaGraph({ userId, to, subject, body, attachmentIds });
}

export interface SendFollowUpParams {
  userId: string;
  provider: EmailProvider;
  to: string;
  originalSubject: string;
  originalSentAtIso: string;
  replyBody: string;
  attachmentIds?: string[];
}

/**
 * Sends a follow-up as a threaded reply to the original sent message,
 * routed to whichever provider originally sent it.
 */
export async function sendFollowUp(params: SendFollowUpParams): Promise<void> {
  const { userId, provider, to, originalSubject, originalSentAtIso, replyBody, attachmentIds = [] } = params;
  const replyBodyHtml = replyBody.replace(/\r?\n/g, '<br>');

  if (env.SAFE_MODE) {
    logger.info('[SAFE_MODE] Follow-up not sent – would have sent:', { to, originalSubject, provider });
    return;
  }

  if (provider === EmailProvider.GMAIL) {
    const attachments = await loadAttachmentFiles(attachmentIds);
    await sendThreadedGmailFollowUp({ userId, to, originalSubject, replyBodyHtml, attachments });
    return;
  }

  const attachments = await loadAttachmentFiles(attachmentIds);
  const accessToken = await getValidAccessToken(userId);
  await sendThreadedFollowUp({
    accessToken,
    recipientEmail: to,
    originalSubject,
    originalSentAtIso,
    replyBodyHtml,
    attachments,
  });
}
