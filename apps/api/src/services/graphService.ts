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
        content: body,
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
