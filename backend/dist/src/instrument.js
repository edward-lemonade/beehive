// Loaded with `node --import` before the app so Sentry can instrument http, fetch and postgres.
import * as Sentry from '@sentry/hono/node';
import { redact, scrubAttributes, scrubEvent } from './observability/scrub.js';
const dsn = process.env.SENTRY_DSN_API?.trim();
const recordLlmIo = process.env.SENTRY_RECORD_LLM_IO === 'true';
async function profiling() {
    try {
        const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
        return [nodeProfilingIntegration()];
    }
    catch (error) {
        console.warn('Sentry profiling unavailable on this platform:', error instanceof Error ? error.message : error);
        return [];
    }
}
if (dsn && !process.env.VITEST) {
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        release: process.env.SENTRY_RELEASE || undefined,
        tracesSampleRate: 1.0,
        profileSessionSampleRate: 1.0,
        profileLifecycle: 'trace',
        // v11 collects bodies, DB params and locals by default. Here those hold prompts, listings, contacts and private bounds.
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
            stackFrameVariables: false,
            queues: false,
            genAI: { inputs: recordLlmIo, outputs: recordLlmIo },
        },
        integrations: [
            ...(await profiling()),
            Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
        ],
        beforeSend: (event) => scrubEvent(event),
        // v11 streams spans by default, so span scrubbing happens here rather than in beforeSendTransaction.
        beforeSendSpan: (span) => ({ ...span, name: redact(span.name), attributes: scrubAttributes(span.attributes) }),
        beforeSendLog: (log) => ({ ...log, message: typeof log.message === 'string' ? redact(log.message) : log.message, attributes: scrubAttributes(log.attributes) }),
    });
    console.log(`Sentry enabled (env=${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'}, llm_io=${recordLlmIo})`);
}
