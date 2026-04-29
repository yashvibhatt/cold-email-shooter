import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { parseUploadedFile, parseContactsFile } from '../services/fileParser';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export const filesRouter = Router();

// Ensure upload dir exists
fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

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
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/files/upload – parse file and return preview (does NOT persist email jobs yet)
filesRouter.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      if (!req.file) throw new ValidationError('No file uploaded');

      const result = await parseUploadedFile(req.file.path, req.file.originalname);

      if (result.missingColumns.length > 0) {
        // Clean up the file
        fs.unlinkSync(req.file.path);
        throw new ValidationError(
          `Missing required columns: ${result.missingColumns.join(', ')}`,
          { required: result.missingColumns }
        );
      }

      // Save the file record so we can reference it when scheduling
      const fileRecord = await prisma.uploadedFile.create({
        data: {
          userId: currentUser.id,
          originalName: req.file.originalname,
          storedName: req.file.filename,
          rowCount: result.totalRows,
        },
      });

      logger.info('File uploaded and parsed', {
        userId: currentUser.id,
        fileId: fileRecord.id,
        rows: result.totalRows,
        valid: result.validRows,
      });

      res.json({
        success: true,
        data: {
          fileId: fileRecord.id,
          originalName: req.file.originalname,
          ...result,
        },
      });
    } catch (err) {
      // Clean up file on error
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      next(err);
    }
  }
);

// POST /api/files/upload-contacts – parse any contacts CSV (Apollo, LinkedIn, etc.)
filesRouter.post(
  '/upload-contacts',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;
      if (!req.file) throw new ValidationError('No file uploaded');

      const result = await parseContactsFile(req.file.path, req.file.originalname);

      if (result.totalContacts === 0) {
        fs.unlinkSync(req.file.path);
        throw new ValidationError('No valid email addresses found in this file');
      }

      const fileRecord = await prisma.uploadedFile.create({
        data: {
          userId: currentUser.id,
          originalName: req.file.originalname,
          storedName: req.file.filename,
          rowCount: result.totalContacts,
        },
      });

      logger.info('Contacts file uploaded', {
        userId: currentUser.id,
        fileId: fileRecord.id,
        contacts: result.totalContacts,
        format: result.detectedFormat,
      });

      res.json({
        success: true,
        data: { fileId: fileRecord.id, originalName: req.file.originalname, ...result },
      });
    } catch (err) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      next(err);
    }
  }
);

// GET /api/files – list all uploaded files for the authenticated user
filesRouter.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentUser } = req as AuthedRequest;

      const files = await prisma.uploadedFile.findMany({
        where: { userId: currentUser.id },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { emailJobs: true } },
        },
      });

      res.json({ success: true, data: files });
    } catch (err) {
      next(err);
    }
  }
);
