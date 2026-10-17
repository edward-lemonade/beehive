import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { events } from './events.js';
import { sseHub } from './sse/hub.js';
import { intentsRouter, publicMapRouter } from './intents/routes.js';

const app = new Hono();
app.use('*', logger());

app.get('/health', (c) => c.json({ ok: true, status: 'healthy', timeScale: config.TIME_SCALE }));

app.get('/stream', (c) => {
  const userId = c.req.header('x-user-id') ?? 'demo-user';
  return sseHub.streamForUser(userId);
});

app.route('/intents', intentsRouter);
app.route('/map', publicMapRouter);

app.onError((err, c) => c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500));

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

events.emit('notify', { userId: 'demo-user', kind: 'health-check', payload: { ok: true } });

export default app;
