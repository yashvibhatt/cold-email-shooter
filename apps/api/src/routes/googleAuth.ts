import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import {
  isGoogleConfigured,
  getGoogleLoginUrl,
  handleGoogleCallback,
} from '../services/googleService';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AuthError, AppError } from '../utils/validation';
import { requireAuth, AuthedRequest } from '../middleware/auth';

export const googleAuthRouter = Router();

// GET /api/auth/google/login — must already be logged in via Outlook; Gmail is a secondary connection
googleAuthRouter.get('/login', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isGoogleConfigured()) {
      throw new AppError(
        'Gmail integration is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.',
        503,
        'GOOGLE_NOT_CONFIGURED'
      );
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.googleOauthState = state;

    const authUrl = getGoogleLoginUrl(state);
    res.json({ success: true, data: { authUrl } });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/google/callback
googleAuthRouter.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      return res.redirect(`${env.FRONTEND_URL}/dashboard?googleError=${encodeURIComponent(error)}`);
    }

    if (!req.session.userId) {
      throw new AuthError('Not logged in. Please log in with Microsoft first.');
    }
    if (!state || state !== req.session.googleOauthState) {
      throw new AuthError('Invalid OAuth state. Possible CSRF attack.');
    }
    delete req.session.googleOauthState;

    if (!code) throw new AuthError('No authorization code received from Google');

    const result = await handleGoogleCallback(code);

    if (!result.refreshToken) {
      // Happens if the user previously connected and Google didn't re-issue a refresh
      // token (prompt=consent should prevent this, but guard anyway).
      logger.warn('Google callback returned no refresh token', { userId: req.session.userId });
    }

    await prisma.user.update({
      where: { id: req.session.userId },
      data: {
        googleId: result.googleId,
        googleEmail: result.googleEmail,
        googleAccessToken: result.accessToken,
        ...(result.refreshToken ? { googleRefreshToken: result.refreshToken } : {}),
        googleTokenExpiry: new Date(result.expiryDate),
      },
    });

    logger.info('Gmail connected', { userId: req.session.userId, googleEmail: result.googleEmail });

    return res.redirect(`${env.FRONTEND_URL}/dashboard?googleConnected=1`);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/google/status
googleAuthRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  const { currentUser } = req as AuthedRequest;
  const user = await prisma.user.findUnique({ where: { id: currentUser.id } });

  res.json({
    success: true,
    data: {
      configured: isGoogleConfigured(),
      connected: !!(user?.googleId && user?.googleRefreshToken),
      email: user?.googleEmail ?? null,
    },
  });
});

// POST /api/auth/google/disconnect
googleAuthRouter.post('/disconnect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentUser } = req as AuthedRequest;
    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        googleId: null,
        googleEmail: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
      },
    });
    res.json({ success: true, data: { message: 'Gmail disconnected' } });
  } catch (err) {
    next(err);
  }
});
