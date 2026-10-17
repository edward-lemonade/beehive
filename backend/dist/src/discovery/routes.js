import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { getIntentRepository } from '../intents/service.js';
import { detectNearMisses, relevantTo } from './service.js';
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const discoveryRouter = new Hono();
discoveryRouter.use('*', requireAuth);
discoveryRouter.get('/:id/near-misses', async (c) => {
    const id = c.req.param('id');
    const intent = isUuid(id) ? await getIntentRepository().get(id) : undefined;
    if (!intent)
        return c.json({ ok: false, error: 'Intent not found' }, 404);
    if (intent.ownerId !== c.get('user').id)
        return c.json({ ok: false, error: 'Forbidden' }, 403);
    return c.json({ ok: true, nearMisses: await detectNearMisses(intent.id) });
});
discoveryRouter.get('/:id/relevant', async (c) => {
    const id = c.req.param('id');
    const ownIntentId = isUuid(id) ? await relevantTo(c.get('user').id, id) : null;
    return c.json({ ok: true, relevant: ownIntentId !== null, ownIntentId });
});
