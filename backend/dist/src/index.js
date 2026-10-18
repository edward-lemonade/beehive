import { contactRouter } from './channel/contact.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requireAuth } from './auth.js';
import { installSseBridge } from './sse/bridge.js';
import { config } from './config.js';
import { sseHub } from './sse/hub.js';
import { agentRouter } from './agent/routes.js';
import { channelRouter } from './channel/routes.js';
import { createPhotonAdapter } from './channel/photon.js';
import { discoveryRouter } from './discovery/routes.js';
import { installNegotiation } from './negotiation/session.js';
import { negotiationRouter } from './negotiation/routes.js';
import { seedRouter } from './seed/routes.js';
import { startRuntime } from './runtime/registry.js';
import { runtimeRouter } from './runtime/routes.js';
import { arrangementsRouter } from './arrangements/routes.js';
import { startCoordinator } from './arrangements/coordinator.js';
import { startDiscovery } from './discovery/service.js';
import { intentsRouter, publicMapRouter } from './intents/routes.js';
import { sentry } from '@sentry/hono/node';
import { sql } from './db/index.js';
import { demoRouter } from './observability/demo.js';
import { installConversationLog } from './observability/conversation.js';
import { installMonitors } from './observability/monitors.js';
import { Sentry } from './observability/telemetry.js';
import { createHttpErrorMiddleware } from './observability/http-errors.js';
const app = new Hono();
// Sentry.init runs in src/instrument.ts (loaded with --import); this only instruments requests.
app.use(sentry(app));
const requestErrors = new WeakMap();
app.use('*', createHttpErrorMiddleware((failure) => {
    if (failure.error) {
        Sentry.captureException(failure.error);
        return;
    }
    Sentry.captureMessage(`HTTP ${failure.status} response`, {
        level: failure.status >= 500 ? 'error' : 'warning',
        tags: {
            'http.request.method': failure.method,
            'http.response.status_code': String(failure.status),
        },
        extra: { path: failure.path },
    });
}, (context) => requestErrors.get(context)));
const photon = config.CHANNEL === 'photon' ? await createPhotonAdapter() : null;
app.use('*', logger());
app.use('*', cors({
    origin: (origin) => (config.FRONTEND_ORIGIN === '*' ? origin : config.FRONTEND_ORIGIN),
    // sentry-trace and baggage let a browser click and the agents it wakes share one distributed trace.
    allowHeaders: ['Authorization', 'Content-Type', 'sentry-trace', 'baggage'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));
// Sentry Uptime polls this, so it checks the database too, not just that the process answers.
app.get('/health', async (c) => {
    try {
        await sql `select 1`;
        return c.json({ ok: true, status: 'healthy', timeScale: config.TIME_SCALE });
    }
    catch {
        return c.json({ ok: false, status: 'database_unreachable' }, 503);
    }
});
app.get('/stream', requireAuth, (c) => sseHub.streamForUser(c.get('user').id, c.req.raw.signal));
app.route('/intents', intentsRouter);
app.route('/intents', discoveryRouter);
app.route('/intents', runtimeRouter);
app.route('/negotiate', negotiationRouter);
app.route('/arrangements', arrangementsRouter);
app.route('/map', publicMapRouter);
app.route('/me', channelRouter);
app.route('/me', contactRouter);
app.route('/agent', agentRouter);
app.route('/dev', seedRouter);
if (config.DEMO_MODE)
    app.route('/demo', demoRouter);
installNegotiation();
installMonitors();
installConversationLog();
installSseBridge();
if (!process.env.VITEST) {
    startDiscovery();
    startRuntime()
        .then(() => startCoordinator())
        .catch((error) => console.error('runtime failed to start', error));
}
app.onError((err, c) => {
    requestErrors.set(c, err);
    return c.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
});
app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));
if (!process.env.VITEST) {
    const port = Number(process.env.PORT ?? 3000);
    if (photon) {
        const stopPhoton = () => {
            void photon.stop().catch((error) => {
                console.error('Photon shutdown failed:', error instanceof Error ? error.message : error);
            });
        };
        process.once('SIGTERM', stopPhoton);
        process.once('SIGINT', stopPhoton);
    }
    serve({ fetch: app.fetch, port }, () => console.log(`API listening on :${port}`));
}
export default app;
