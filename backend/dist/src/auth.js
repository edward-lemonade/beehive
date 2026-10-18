import { createClerkClient, verifyToken } from '@clerk/backend';
import { config } from './config.js';
import { ensureUserForClerkId, syncHandle } from './db/index.js';
import { Sentry } from './observability/telemetry.js';
function parseBearer(tokenHeader) {
    if (!tokenHeader)
        return null;
    const match = /^Bearer\s+(.+)$/i.exec(tokenHeader);
    return match ? match[1] : null;
}
function stableHandle(clerkId) {
    const suffix = clerkId.slice(-4) || '0000';
    return `Otter-${suffix}`;
}
const clerk = createClerkClient({ secretKey: config.CLERK_SECRET_KEY });
const profileCache = new Map();
export async function clerkProfile(clerkId) {
    const cached = profileCache.get(clerkId);
    if (cached)
        return cached;
    try {
        const u = await clerk.users.getUser(clerkId);
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
        const profile = { handle: u.username || name || null, imageUrl: u.imageUrl || null };
        profileCache.set(clerkId, profile);
        return profile;
    }
    catch {
        return { handle: null, imageUrl: null };
    }
}
export const requireAuth = (() => {
    const handler = async (c, next) => {
        const authHeader = c.req.header('Authorization');
        const token = parseBearer(authHeader);
        if (!token) {
            return c.json({ ok: false, error: 'Missing or invalid authorization token' }, 401);
        }
        let clerkId;
        try {
            const claims = await verifyToken(token, { secretKey: config.CLERK_SECRET_KEY });
            if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
                return c.json({ ok: false, error: 'Invalid authorization token' }, 401);
            }
            clerkId = claims.sub;
        }
        catch {
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
        });
        // Public handle and internal id only; never the Clerk email or phone.
        Sentry.setUser({ id: user.id, username: user.handle });
        Sentry.setTag('user.tier', user.tier);
        await next();
    };
    return handler;
})();
export const publicConfig = {
    clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY,
    apiUrl: config.VITE_API_URL ?? '',
};
