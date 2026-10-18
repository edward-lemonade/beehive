import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
export { Sentry };
const clean = (attrs = {}) => Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null));
/** One call for slices to open a span; a no-op wrapper when Sentry is disabled. */
export function withSpan(name, op, attrs, fn) {
    return Sentry.startSpan({ name, op, attributes: clean(attrs) }, fn);
}
export const metric = {
    count(name, attrs, value = 1) {
        Sentry.metrics.count(name, value, { attributes: clean(attrs) });
    },
    dist(name, value, unit, attrs) {
        Sentry.metrics.distribution(name, value, { unit, attributes: clean(attrs) });
    },
    gauge(name, value, attrs) {
        Sentry.metrics.gauge(name, value, { attributes: clean(attrs) });
    },
};
export const log = {
    info: (message, attrs) => Sentry.logger.info(message, clean(attrs)),
    warn: (message, attrs) => Sentry.logger.warn(message, clean(attrs)),
    error: (message, attrs) => Sentry.logger.error(message, clean(attrs)),
};
/** Headers for the active span, so a message carries its trace across the bus or a timer. */
export function traceHeaders() {
    // Without an active span the scope's fallback trace id would glue unrelated background work into one huge trace.
    if (!Sentry.getActiveSpan())
        return {};
    const data = Sentry.getTraceData();
    const headers = {};
    if (data['sentry-trace'])
        headers.sentryTrace = data['sentry-trace'];
    if (data.baggage)
        headers.baggage = data.baggage;
    return headers;
}
/** Runs fn as a continuation of the trace in `headers`, detached from whatever span happens to be active now. */
export function continueFrom(headers, fn) {
    return Sentry.withActiveSpan(null, () => {
        if (!headers?.sentryTrace)
            return Sentry.startNewTrace(fn);
        return Sentry.continueTrace({ sentryTrace: headers.sentryTrace, baggage: headers.baggage }, fn);
    });
}
/** Stable, non-reversible id for grouping identical payloads without sending them. */
export function fingerprintText(text) {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}
