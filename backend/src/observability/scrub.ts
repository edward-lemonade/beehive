// Second privacy layer: whatever slips into an event, log or span text is redacted before it leaves the process.
const PHONE = /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER = /Bearer\s+[\w.-]+/gi;
const SENSITIVE_KEYS = /^(authorization|cookie|phone|contact|email|text|freeText|sourceText|minNetCents|maxCents|minCents|bounds?)$/i;

export function redact(value: string): string {
  return value.replace(BEARER, 'Bearer [redacted]').replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : scrubValue(v, depth + 1);
  }
  return out;
}

type ScrubbableEvent = {
  message?: string;
  request?: { data?: unknown; cookies?: unknown; headers?: Record<string, string>; query_string?: unknown };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  extra?: Record<string, unknown>;
};

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = redact(event.message);
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (/authorization|cookie/i.test(key)) event.request.headers[key] = '[redacted]';
      }
    }
  }
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = redact(ex.value);
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = redact(crumb.message);
    if (crumb.data) crumb.data = scrubValue(crumb.data);
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  return event;
}

export function scrubAttributes<T extends Record<string, unknown> | undefined>(attributes: T): T {
  return (attributes ? scrubValue(attributes) : attributes) as T;
}
