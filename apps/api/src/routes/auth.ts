import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { getGraphUserProfile } from '../services/graphService';
import { logger } from '../utils/logger';
import { AuthError } from '../utils/validation';
import { requireAuth, AuthedRequest } from '../middleware/auth';

export const authRouter = Router();

const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'Mail.Send', 'User.Read'];

function getMsalClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`,
    },
  });
}

function serializeMsalCache(client: ConfidentialClientApplication): string {
  return client.getTokenCache().serialize();
}

// GET /api/auth/login
authRouter.get('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const msalClient = getMsalClient();
    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
      state,
      prompt: 'select_account',
    });

    res.json({ success: true, data: { authUrl } });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/callback
authRouter.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      logger.error('OAuth error', { error, error_description });
      return res.redirect(`${env.FRONTEND_URL}?error=${encodeURIComponent(error_description || error)}`);
    }

    // CSRF check
    if (!state || state !== req.session.oauthState) {
      throw new AuthError('Invalid OAuth state. Possible CSRF attack.');
    }
    delete req.session.oauthState;

    if (!code) throw new AuthError('No authorization code received');

    const msalClient = getMsalClient();
    const tokenResponse = await msalClient.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
    });

    if (!tokenResponse?.accessToken) {
      throw new AuthError('Failed to acquire access token');
    }

    // Serialize the full MSAL token cache — this is the only reliable way to
    // persist the refresh token for organizational (university) accounts.
    const msalCacheJson = serializeMsalCache(msalClient);

    // Fetch user profile
    const profile = await getGraphUserProfile(tokenResponse.accessToken);
    const email = profile.mail || profile.userPrincipalName;

    const tokenExpiry = tokenResponse.expiresOn ?? new Date(Date.now() + 3600 * 1000);

    const user = await prisma.user.upsert({
      where: { microsoftId: profile.id },
      create: {
        microsoftId: profile.id,
        email,
        displayName: profile.displayName,
        accessToken: tokenResponse.accessToken,
        refreshToken: '',       // kept for schema compatibility; real tokens live in msalCacheJson
        tokenExpiry,
        msalCacheJson,
      },
      update: {
        email,
        displayName: profile.displayName,
        accessToken: tokenResponse.accessToken,
        tokenExpiry,
        msalCacheJson,
        updatedAt: new Date(),
      },
    });

    req.session.userId = user.id;
    logger.info('User logged in', { userId: user.id, email: user.email });

    return res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const { currentUser } = req as AuthedRequest;
  res.json({
    success: true,
    data: {
      id: currentUser.id,
      email: currentUser.email,
      displayName: currentUser.displayName,
    },
  });
});

// GET /api/auth/token-status — lets the dashboard check if the token is still healthy
authRouter.get('/token-status', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentUser } = req as AuthedRequest;
    const expiresInMs = currentUser.tokenExpiry.getTime() - Date.now();
    const hasMsalCache = !!(currentUser as any).msalCacheJson;

    res.json({
      success: true,
      data: {
        valid: expiresInMs > 0,
        expiresInMinutes: Math.round(expiresInMs / 60000),
        hasMsalCache,
        needsRelogin: !hasMsalCache,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  });
});
