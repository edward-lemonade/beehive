import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { loadSeed, seedOptions } from './scenario.js';
export const seedRouter = new Hono();
seedRouter.use('*', requireAuth);
seedRouter.get('/seeds', (c) => {
    if (process.env.NODE_ENV === 'production')
        return c.json({ ok: false, error: 'Not available' }, 404);
    return c.json({ ok: true, scenarios: seedOptions() });
});
seedRouter.post('/seed', async (c) => {
    if (process.env.NODE_ENV === 'production')
        return c.json({ ok: false, error: 'Not available' }, 404);
    const body = z.object({ scenarioId: z.string().default('ticket-swap') }).safeParse(await c.req.json());
    if (!body.success)
        return c.json({ ok: false, error: 'Invalid seed input' }, 400);
    if (!seedOptions().some((scenario) => scenario.id === body.data.scenarioId)) {
        return c.json({ ok: false, error: 'Unknown seed dataset' }, 400);
    }
    try {
        return c.json({ ok: true, ...(await loadSeed(body.data.scenarioId)) });
    }
    catch (error) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : 'Seeding failed' }, 502);
    }
});
