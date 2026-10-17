import { verifyToken } from '@clerk/backend';
import { config } from './config.js';
import { ensureUserForClerkId } from './db/index.js';
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
        c.set('user', {
            id: user.id,
            clerkId: user.clerk_id,
            handle: user.handle,
            tier: user.tier,
        });
        await next();
    };
    return handler;
})();
export const publicConfig = {
    clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY,
    apiUrl: config.VITE_API_URL ?? '',
};
