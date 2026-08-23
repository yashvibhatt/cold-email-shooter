import {
  ConfidentialClientApplication,
  ICachePlugin,
  TokenCacheContext,
  InteractionRequiredAuthError,
} from '@azure/msal-node';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'Mail.Send', 'Mail.ReadWrite', 'User.Read'];

/**
 * Builds a ConfidentialClientApplication that reads its token cache from the
 * provided JSON string and writes any changes back via the returned flush function.
 */
function buildMsalClientWithCache(initialCacheJson: string | null | undefined): {
  client: ConfidentialClientApplication;
  flushCache: () => string | null;
} {
  let updatedCache: string | null = null;

  const cachePlugin: ICachePlugin = {
    beforeCacheAccess: async (ctx: TokenCacheContext) => {
      if (initialCacheJson) {
        ctx.tokenCache.deserialize(initialCacheJson);
      }
    },
    afterCacheAccess: async (ctx: TokenCacheContext) => {
      if (ctx.cacheHasChanged) {
        updatedCache = ctx.tokenCache.serialize();
      }
    },
  };

  const client = new ConfidentialClientApplication({
    auth: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`,
    },
    cache: { cachePlugin },
  });

  return { client, flushCache: () => updatedCache };
}

/**
 * Returns a valid access token. Refreshes silently via MSAL if the stored
 * token is within 60 seconds of expiry.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const buffer = 60 * 1000; // refresh 60s before expiry

  if (user.tokenExpiry.getTime() - Date.now() > buffer) {
    return user.accessToken;
  }

  logger.debug('Access token expiring soon, refreshing', { userId });
  return refreshAccessToken(userId);
}

/**
 * Silently acquires a new access token using MSAL's cached refresh token.
 * This handles university (organizational) accounts correctly — unlike a raw
 * HTTP refresh, MSAL uses the correct tenant authority and handles token
 * rotation automatically.
 *
 * Throws an AppError with code AUTH_RELOGIN_REQUIRED if the session can no
 * longer be refreshed (e.g. university policy invalidated the token).
 */
export async function refreshAccessToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.msalCacheJson) {
    throw Object.assign(
      new Error('No MSAL session found. Please log in again.'),
      { code: 'AUTH_RELOGIN_REQUIRED' }
    );
  }

  const { client, flushCache } = buildMsalClientWithCache(user.msalCacheJson);

  let accounts: Awaited<ReturnType<typeof client.getTokenCache>['getAllAccounts']>;
  try {
    accounts = await client.getTokenCache().getAllAccounts();
  } catch {
    accounts = [];
  }

  if (!accounts || accounts.length === 0) {
    throw Object.assign(
      new Error('MSAL token cache has no accounts. Please log in again.'),
      { code: 'AUTH_RELOGIN_REQUIRED' }
    );
  }

  let result;
  try {
    result = await client.acquireTokenSilent({
      account: accounts[0],
      scopes: SCOPES,
      forceRefresh: true,
    });
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      throw Object.assign(
        new Error(
          'Your session has expired and cannot be automatically renewed. ' +
          'This is common with university accounts that restrict long-lived tokens. ' +
          'Please log in again.'
        ),
        { code: 'AUTH_RELOGIN_REQUIRED' }
      );
    }
    throw err;
  }

  if (!result?.accessToken) {
    throw Object.assign(
      new Error('Silent token acquisition returned no access token. Please log in again.'),
      { code: 'AUTH_RELOGIN_REQUIRED' }
    );
  }

  const newCache = flushCache();

  await prisma.user.update({
    where: { id: userId },
    data: {
      accessToken: result.accessToken,
      tokenExpiry: result.expiresOn ?? new Date(Date.now() + 3600 * 1000),
      ...(newCache ? { msalCacheJson: newCache } : {}),
    },
  });

  logger.info('Token refreshed via MSAL acquireTokenSilent', { userId });
  return result.accessToken;
}
