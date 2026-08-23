import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { parseContactsFile } from '../services/fileParser';
import { checkOutreachHistory } from '../services/graphService';
import { getValidAccessToken } from '../services/tokenService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export const outreachRouter = Router();

const storage = multer.diskStorage({
  destination: env.UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new ValidationError(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
  },
});

// POST /api/outreach/check – upload a CSV, check each recipient against Outlook Sent Items
outreachRouter.post(
  '/check',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      if (!req.file) throw new ValidationError('No file uploaded');

      const parsed = await parseContactsFile(req.file.path, req.file.originalname);
      fs.unlink(req.file.path, () => {});

      if (parsed.totalContacts === 0) {
        throw new ValidationError('No valid email addresses found in this file');
      }

      const accessToken = await getValidAccessToken(currentUser.id);
      const outreachResults = await checkOutreachHistory(
        accessToken,
        parsed.contacts.map((c) => c.email)
      );

      const byEmail = new Map(outreachResults.map((r) => [r.email, r]));

      const results = parsed.contacts.map((c) => {
        const match = byEmail.get(c.email.toLowerCase());
        return {
          ...c,
          alreadyContacted: match?.alreadyContacted ?? false,
          lastContactDate: match?.lastContactDate ?? null,
          lastSubject: match?.lastSubject ?? null,
          matchCount: match?.matchCount ?? 0,
          checkError: match?.error ?? null,
        };
      });

      const contactedCount = results.filter((r) => r.alreadyContacted).length;

      logger.info('Outreach check completed', {
        userId: currentUser.id,
        total: results.length,
        contacted: contactedCount,
        new: results.length - contactedCount,
      });

      res.json({
        success: true,
        data: {
          detectedFormat: parsed.detectedFormat,
          skippedRows: parsed.skippedRows,
          total: results.length,
          contacted: contactedCount,
          new: results.length - contactedCount,
          results,
        },
      });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      next(err);
    }
  }
);
