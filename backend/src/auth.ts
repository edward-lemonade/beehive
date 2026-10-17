import type { Context, MiddlewareHandler } from 'hono';
import { config } from './config.js';
import { ensureUserForClerkId } from './db/index.js';

export type AuthUser = {
  id: string;
  clerkId: string;
  handle: string;
  tier: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

function parseBearer(tokenHeader: string | undefined): string | null {
  if (!tokenHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(tokenHeader);
  return match ? match[1] : null;
}

function stableHandle(clerkId: string): string {
  const suffix = clerkId.slice(-4) || '0000';
  return `Otter-${suffix}`;
}

export const requireAuth = (() => {
  const handler: MiddlewareHandler = async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = parseBearer(authHeader);

    if (!token) {
      return c.json({ ok: false, error: 'Missing or invalid authorization token' }, 401);
    }

    const issuer = (token.split('.').length >= 2 ? token.split('.')[1] : '').slice(0, 8) || 'dev';
    const clerkId = `clerk_${issuer}`;
    const user = await ensureUserForClerkId(clerkId, {
      handle: stableHandle(clerkId),
      tier: 'new',
      phone: null,
      phoneVerified: false,
    });

    if (!user) {
      return c.json({ ok: false, error: 'Authentication failed' }, 401);
    }

    c.set('user', {
      id: user.id,
      clerkId: user.clerk_id,
      handle: user.handle,
      tier: user.tier,
    } satisfies AuthUser);
    await next();
  };

  return handler;
})();

export const publicConfig = {
  clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY,
  apiUrl: config.VITE_API_URL ?? '',
};
