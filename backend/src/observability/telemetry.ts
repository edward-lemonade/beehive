import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';

export { Sentry };

type Primitive = string | number | boolean;
export type Attrs = Record<string, Primitive | undefined | null>;

const clean = (attrs: Attrs = {}): Record<string, Primitive> =>
  Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null)) as Record<string, Primitive>;

/** One call for slices to open a span; a no-op wrapper when Sentry is disabled. */
export function withSpan<T>(name: string, op: string, attrs: Attrs, fn: (span: Sentry.Span) => T): T {
  return Sentry.startSpan({ name, op, attributes: clean(attrs) }, fn);
}

export const metric = {
  count(name: string, attrs?: Attrs, value = 1): void {
    Sentry.metrics.count(name, value, { attributes: clean(attrs) });
  },
  dist(name: string, value: number, unit: string, attrs?: Attrs): void {
    Sentry.metrics.distribution(name, value, { unit, attributes: clean(attrs) });
  },
  gauge(name: string, value: number, attrs?: Attrs): void {
    Sentry.metrics.gauge(name, value, { attributes: clean(attrs) });
  },
};

export const log = {
  info: (message: string, attrs?: Attrs) => Sentry.logger.info(message, clean(attrs)),
  warn: (message: string, attrs?: Attrs) => Sentry.logger.warn(message, clean(attrs)),
  error: (message: string, attrs?: Attrs) => Sentry.logger.error(message, clean(attrs)),
};

export type TraceHeaders = { sentryTrace?: string; baggage?: string };

/** Headers for the active span, so a message carries its trace across the bus or a timer. */
export function traceHeaders(): TraceHeaders {
  // Without an active span the scope's fallback trace id would glue unrelated background work into one huge trace.
  if (!Sentry.getActiveSpan()) return {};
  const data = Sentry.getTraceData();
  const headers: TraceHeaders = {};
  if (data['sentry-trace']) headers.sentryTrace = data['sentry-trace'];
  if (data.baggage) headers.baggage = data.baggage;
  return headers;
}

/** Runs fn as a continuation of the trace in `headers`, detached from whatever span happens to be active now. */
export function continueFrom<T>(headers: TraceHeaders | undefined, fn: () => T): T {
  return Sentry.withActiveSpan(null, () => {
    if (!headers?.sentryTrace) return Sentry.startNewTrace(fn);
    return Sentry.continueTrace({ sentryTrace: headers.sentryTrace, baggage: headers.baggage }, fn);
  });
}

/** Stable, non-reversible id for grouping identical payloads without sending them. */
export function fingerprintText(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 16);
}
