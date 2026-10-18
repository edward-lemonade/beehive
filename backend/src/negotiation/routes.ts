import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { negotiateDirect } from './service.js';

const bodySchema = z.object({
  ownIntentId: z.string().min(1),
  targetIntentId: z.string().min(1),
  targetCents: z.number().int().nonnegative().optional(),
}).strict();

export const negotiationRouter = new Hono();
negotiationRouter.use('*', requireAuth);

negotiationRouter.post('/', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
  const result = await negotiateDirect(c.get('user').id, parsed.data);
  switch (result.status) {
    case 'not_found': return c.json({ ok: false, error: 'Intent not found' }, 404);
    case 'forbidden': return c.json({ ok: false, error: 'Forbidden' }, 403);
    case 'not_relevant': return c.json({ ok: false, error: 'Target is not relevant to this intent' }, 403);
    default: return c.json({ ok: true, ...result });
  }
});
