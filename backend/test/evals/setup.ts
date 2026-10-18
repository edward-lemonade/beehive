import { existsSync } from 'node:fs';
import * as Sentry from '@sentry/node';
import { redact, scrubAttributes, scrubEvent } from '../../src/observability/scrub.js';

// Evals use the real LLM configured in backend/.env.
if (existsSync('.env')) process.loadEnvFile('.env');
for (const key of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL_FAST']) {
  if (!process.env[key]) throw new Error(`${key} is missing from backend/.env. Evals need a working LLM: set LLM_API_KEY, LLM_BASE_URL and LLM_MODEL_FAST.`);
}
process.env.DATABASE_URL ||= 'postgres://localhost:5432/test';
process.env.CLERK_SECRET_KEY ||= 'sk_test_local';
process.env.CLERK_PUBLISHABLE_KEY ||= 'pk_test_local';
process.env.CHANNEL ||= 'terminal';

// Results go to Sentry under environment "eval" (separate from production dashboards). EVAL_SENTRY=false keeps them local.
const dsn = process.env.SENTRY_DSN_API?.trim();
if (dsn && process.env.EVAL_SENTRY !== 'false' && !Sentry.getClient()) {
  Sentry.init({
    dsn,
    environment: 'eval',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 1.0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false, queues: false, genAI: { inputs: false, outputs: false } },
    beforeSendSpan: (span) => ({ ...span, name: redact(span.name), attributes: scrubAttributes(span.attributes) }),
    beforeSend: (event) => scrubEvent(event),
    beforeSendLog: (log) => ({ ...log, message: typeof log.message === 'string' ? redact(log.message) : log.message, attributes: scrubAttributes(log.attributes) }),
  });
}
