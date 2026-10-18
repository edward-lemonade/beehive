import { createClerkClient, verifyToken } from '@clerk/backend';
import type { Context, MiddlewareHandler } from 'hono';
import { config } from './config.js';
import { ensureUserForClerkId, syncHandle } from './db/index.js';

export type AuthUser = {
  id: string;
  clerkId: string;
  handle: string;
  tier: string;
  imageUrl: string | null;
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

const clerk = createClerkClient({ secretKey: config.CLERK_SECRET_KEY });
type Profile = { handle: string | null; imageUrl: string | null };
const profileCache = new Map<string, Profile>();

export async function clerkProfile(clerkId: string): Promise<Profile> {
  const cached = profileCache.get(clerkId);
  if (cached) return cached;
  try {
    const u = await clerk.users.getUser(clerkId);
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
    const profile = { handle: u.username || name || null, imageUrl: u.imageUrl || null };
    profileCache.set(clerkId, profile);
    return profile;
  } catch {
    return { handle: null, imageUrl: null };
  }
}

export const requireAuth = (() => {
  const handler: MiddlewareHandler = async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = parseBearer(authHeader);

    if (!token) {
      return c.json({ ok: false, error: 'Missing or invalid authorization token' }, 401);
    }

    let clerkId: string;
    try {
      const claims = await verifyToken(token, { secretKey: config.CLERK_SECRET_KEY });
      if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        return c.json({ ok: false, error: 'Invalid authorization token' }, 401);
      }
      clerkId = claims.sub;
    } catch {
      return c.json({ ok: false, error: 'Invalid authorization token' }, 401);
    }

    const user = await ensureUserForClerkId(clerkId, {
      handle: stableHandle(clerkId),
      tier: 'new',
      phone: null,
      phoneVerified: false,
    });

    if (!user) {
      return c.json({ ok: false, error: 'Authentication failed' }, 401);
    }

    const profile = await clerkProfile(clerkId);
    if (profile.handle && profile.handle !== user.handle) {
      user.handle = profile.handle;
      await syncHandle(user.id, profile.handle);
    }

    c.set('user', {
      id: user.id,
      clerkId: user.clerk_id,
      handle: user.handle,
      tier: user.tier,
      imageUrl: profile.imageUrl,
    } satisfies AuthUser);
    await next();
  };

  return handler;
})();

export const publicConfig = {
  clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY,
  apiUrl: config.VITE_API_URL ?? '',
};
