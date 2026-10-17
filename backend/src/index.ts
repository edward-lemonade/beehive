import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { events } from './events.js';
import { sseHub } from './sse/hub.js';
import { discoveryRouter } from './discovery/routes.js';
import { installNegotiation } from './negotiation/session.js';
import { negotiationRouter } from './negotiation/routes.js';
import { startRuntime } from './runtime/registry.js';
import { runtimeRouter } from './runtime/routes.js';
import { startDiscovery } from './discovery/service.js';
import { intentsRouter, publicMapRouter } from './intents/routes.js';

const app = new Hono();
app.use('*', logger());

app.get('/health', (c) => c.json({ ok: true, status: 'healthy', timeScale: config.TIME_SCALE }));

app.get('/stream', (c) => {
  const userId = c.req.header('x-user-id') ?? 'demo-user';
  return sseHub.streamForUser(userId);
});

app.route('/intents', intentsRouter);
app.route('/intents', discoveryRouter);
app.route('/intents', runtimeRouter);
app.route('/negotiate', negotiationRouter);
app.route('/map', publicMapRouter);

installNegotiation();

if (!process.env.VITEST) {
  startDiscovery();
  startRuntime().catch((error) => console.error('runtime failed to start', error));
}

app.onError((err, c) => c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500));

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

events.emit('notify', { userId: 'demo-user', kind: 'health-check', payload: { ok: true } });

export default app;
