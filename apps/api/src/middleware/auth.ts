import { Request, Response, NextFunction } from 'express';
import { AuthError } from '../utils/validation';
import { prisma } from '../db/prisma';

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AuthError('Not authenticated. Please log in with Microsoft.');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      req.session.destroy(() => {});
      throw new AuthError('Session invalid. Please log in again.');
    }

    (req as Request & { currentUser: typeof user }).currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Helper to access typed user on req
export type AuthedRequest = Request & {
  currentUser: {
    id: string;
    microsoftId: string;
    email: string;
    displayName: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: Date;
  };
};
