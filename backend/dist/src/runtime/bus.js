import { randomUUID } from 'node:crypto';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { guard } from './guard.js';
import { runtimeStats } from './metrics.js';
import { Sentry, continueFrom, traceHeaders } from '../observability/telemetry.js';
const LOG_LIMIT = 5000;
export function makeEnvelope(from, to, body) {
    return { id: randomUUID(), from, to, sentAt: clock.now(), trace: traceHeaders(), body };
}
const logContent = () => config.BUS_LOG_CONTENT ? config.BUS_LOG_CONTENT === 'true' : process.env.NODE_ENV !== 'production';
export class Bus {
    log = [];
    handlers = new Map();
    queues = new Map();
    violationListeners = new Set();
    provider = null;
    setGuardContext(provider) {
        this.provider = provider;
    }
    subscribe(intentId, handler) {
        this.handlers.set(intentId, handler);
        return () => {
            if (this.handlers.get(intentId) === handler)
                this.handlers.delete(intentId);
        };
    }
    onViolation(listener) {
        this.violationListeners.add(listener);
        return () => this.violationListeners.delete(listener);
    }
    // Drop and report on violation; never sanitize and send.
    async send(env) {
        const type = String(env.body?.type);
        return Sentry.startSpan({
            op: 'bus.send',
            name: `send ${type}`,
            attributes: {
                'messaging.message.id': env.id,
                'bus.message_id': env.id,
                'bus.message_type': type,
                'bus.from': String(env.from),
                'bus.to': String(env.to),
                ...(env.body?.type === 'signal' ? {
                    'bus.from_version': env.body.fromVersion,
                    'bus.to_version': env.body.toVersion,
                    'bus.satisfiable': env.body.satisfiable,
                } : {}),
                ...(env.body.type !== 'signal' ? { 'bus.link_id': env.body.linkId } : {}),
            },
        }, async (sendSpan) => {
            if (!this.provider)
                throw new Error('Bus guard context is not configured');
            const result = guard(env, await this.provider(env));
            if (!result.ok) {
                const entry = {
                    id: env.id, at: Date.now(), from: String(env.from), to: String(env.to),
                    type, ...(env.body.type !== 'signal' ? { linkId: env.body.linkId } : {}),
                    delivered: false, status: 'guard_rejected', violation: result.violation.rule,
                };
                if (logContent())
                    entry.body = env.body;
                this.record(entry);
                sendSpan.setAttributes({ 'bus.delivery.status': entry.status, 'bus.guard.violation': result.violation.rule });
                runtimeStats.violations += 1;
                for (const listener of this.violationListeners)
                    listener(result.violation, env);
                return { delivered: false, status: 'guard_rejected', violation: result.violation };
            }
            const handler = this.handlers.get(env.to);
            const entry = {
                id: env.id, at: Date.now(), from: String(env.from), to: String(env.to),
                type, ...(env.body.type !== 'signal' ? { linkId: env.body.linkId } : {}),
                delivered: Boolean(handler), status: handler ? 'enqueued' : 'handler_missing',
            };
            if (logContent())
                entry.body = env.body;
            this.record(entry);
            sendSpan.setAttribute('bus.delivery.status', entry.status);
            if (!handler)
                return { delivered: false, status: 'handler_missing' };
            const sendTrace = traceHeaders();
            const queuedAt = performance.now();
            const previous = this.queues.get(env.to) ?? Promise.resolve();
            const next = previous
                .then(() => new Promise((resolve) => setImmediate(resolve)))
                .then(() => continueFrom(sendTrace.sentryTrace ? sendTrace : env.trace, () => Sentry.startSpan({
                op: 'agent.receive',
                name: `receive ${String(env.body?.type)}`,
                attributes: {
                    'messaging.message.id': env.id,
                    'bus.message_id': env.id,
                    'bus.message_type': type,
                    'bus.from': String(env.from),
                    'bus.to': String(env.to),
                    'bus.delivery.status': 'processing',
                    'bus.queue.delay_ms': Math.max(0, performance.now() - queuedAt),
                    ...(env.body?.type === 'signal' ? {
                        'bus.from_version': env.body.fromVersion,
                        'bus.to_version': env.body.toVersion,
                        'bus.satisfiable': env.body.satisfiable,
                    } : {}),
                    ...(env.body.type !== 'signal' ? { 'bus.link_id': env.body.linkId } : {}),
                },
            }, async (receiveSpan) => {
                try {
                    await handler(result.envelope);
                    entry.status = 'processed';
                    receiveSpan.setAttribute('bus.delivery.status', entry.status);
                }
                catch (error) {
                    entry.status = 'processing_failed';
                    receiveSpan.setAttribute('bus.delivery.status', entry.status);
                    receiveSpan.setStatus({ code: 2, message: error instanceof Error ? error.message : 'handler_failed' });
                    Sentry.captureException(error);
                    console.error('bus handler failed', env.to, error);
                }
            })))
                .finally(() => {
                if (this.queues.get(env.to) === next)
                    this.queues.delete(env.to);
            });
            this.queues.set(env.to, next);
            return { delivered: true, status: 'enqueued' };
        });
    }
    async drain() {
        while (this.queues.size > 0)
            await Promise.all([...this.queues.values()]);
    }
    reset() {
        this.log.length = 0;
        this.handlers.clear();
        this.queues.clear();
        this.violationListeners.clear();
    }
    record(entry) {
        this.log.push(entry);
        if (this.log.length > LOG_LIMIT)
            this.log.splice(0, this.log.length - LOG_LIMIT);
    }
}
export const bus = new Bus();
