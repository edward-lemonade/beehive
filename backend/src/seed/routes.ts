import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { loadSeed } from './scenario.js';

export const seedRouter = new Hono();
seedRouter.use('*', requireAuth);

seedRouter.post('/seed', async (c) => {
  if (process.env.NODE_ENV === 'production') return c.json({ ok: false, error: 'Not available' }, 404);
  try {
    return c.json({ ok: true, ...(await loadSeed()) });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Seeding failed' }, 502);
  }
});
