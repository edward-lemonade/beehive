import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import * as service from './service.js';
import { ArrangementError } from './types.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const furtherSchema = z.object({
  targetCents: z.number().int().nonnegative().optional(),
  linkId: z.string().min(1).optional(),
}).strict();

export const arrangementsRouter = new Hono();
arrangementsRouter.use('*', requireAuth);

async function guarded(c: Context, fn: () => Promise<unknown>): Promise<Response> {
  try {
    return c.json({ ok: true, ...((await fn()) as object | undefined) });
  } catch (error) {
    if (error instanceof ArrangementError) return c.json({ ok: false, error: error.message }, error.status);
    throw error;
  }
}

arrangementsRouter.get('/mine', async (c) => c.json({ ok: true, arrangements: await service.listMine(c.get('user').id) }));

arrangementsRouter.post('/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  if (!uuid.test(id)) return c.json({ ok: false, error: 'Arrangement not found' }, 404);
  const userId = c.get('user').id;

  switch (action) {
    case 'approve': return guarded(c, () => service.approve(userId, id).then(() => ({})));
    case 'decline': return guarded(c, () => service.decline(userId, id).then(() => ({})));
    case 'retract': return guarded(c, () => service.retract(userId, id).then(() => ({})));
    case 'decline-withdraw': return guarded(c, () => service.declineAndWithdraw(userId, id).then(() => ({})));
    case 'negotiate-further': {
      const parsed = furtherSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
      return guarded(c, () => service.negotiateFurther(userId, id, parsed.data));
    }
    default: return c.json({ ok: false, error: 'Not found' }, 404);
  }
});

arrangementsRouter.post('/:id/checklist/:stepId/:state', async (c) => {
  const id = c.req.param('id');
  const state = c.req.param('state');
  if (!uuid.test(id)) return c.json({ ok: false, error: 'Arrangement not found' }, 404);
  if (state !== 'done' && state !== 'undone') return c.json({ ok: false, error: 'Not found' }, 404);
  return guarded(c, async () => ({
    checklist: await service.markStep(c.get('user').id, id, decodeURIComponent(c.req.param('stepId')), state === 'done'),
  }));
});
