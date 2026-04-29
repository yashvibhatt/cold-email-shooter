import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { ValidationError, NotFoundError } from '../utils/validation';
import { logger } from '../utils/logger';

export const attachmentsRouter = Router();

const MAX_ATTACHMENT_MB = 4; // Graph API inline attachment limit is ~3-4 MB

const storage = multer.diskStorage({
  destination: env.UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `att-${Date.now()}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_ATTACHMENT_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Block executables for security
    const blocked = ['.exe', '.bat', '.sh', '.cmd', '.msi', '.ps1'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) {
      cb(new ValidationError(`File type ${ext} is not allowed as an attachment`));
    } else {
      cb(null, true);
    }
  },
});

// POST /api/attachments/upload – upload one or more files, returns attachment metadata
attachmentsRouter.post(
  '/upload',
  requireAuth,
  upload.array('files', 5),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const files = req.files as Express.Multer.File[];

      if (!files?.length) throw new ValidationError('No files uploaded');

      const records = await Promise.all(
        files.map((file) =>
          prisma.attachment.create({
            data: {
              userId: currentUser.id,
              originalName: file.originalname,
              storedName: file.filename,
              mimeType: file.mimetype,
              sizeBytes: file.size,
            },
          })
        )
      );

      logger.info('Attachments uploaded', { userId: currentUser.id, count: records.length });

      res.json({
        success: true,
        data: records.map((r) => ({
          id: r.id,
          originalName: r.originalName,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
        })),
      });
    } catch (err) {
      if (req.files) {
        (req.files as Express.Multer.File[]).forEach((f) => fs.unlink(f.path, () => {}));
      }
      next(err);
    }
  }
);

// GET /api/attachments – list attachments for current user
attachmentsRouter.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const attachments = await prisma.attachment.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      res.json({ success: true, data: attachments });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/attachments/:id
attachmentsRouter.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      const att = await prisma.attachment.findFirst({
        where: { id: req.params.id, userId: currentUser.id },
      });
      if (!att) throw new NotFoundError('Attachment not found');

      const filePath = path.join(env.UPLOAD_DIR, att.storedName);
      fs.unlink(filePath, () => {});
      await prisma.attachment.delete({ where: { id: att.id } });

      res.json({ success: true, data: { message: 'Attachment deleted' } });
    } catch (err) {
      next(err);
    }
  }
);
