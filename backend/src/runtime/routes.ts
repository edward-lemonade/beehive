import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getIntentRepository } from '../intents/service.js';
import { ensureAgent, scheduler } from './registry.js';

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const runtimeRouter = new Hono();
runtimeRouter.use('*', requireAuth);

runtimeRouter.post('/:id/keep-looking', async (c) => {
  const id = c.req.param('id');
  const intent = isUuid(id) ? await getIntentRepository().get(id) : undefined;
  if (!intent) return c.json({ ok: false, error: 'Intent not found' }, 404);
  if (intent.ownerId !== c.get('user').id) return c.json({ ok: false, error: 'Forbidden' }, 403);
  if (intent.state !== 'open') return c.json({ ok: false, error: 'Only open intents can keep looking' }, 409);
  ensureAgent(id);
  scheduler.wake(id, 'keep');
  return c.json({ ok: true }, 202);
});
