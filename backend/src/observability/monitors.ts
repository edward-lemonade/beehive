import type { Envelope } from '../contracts/index.js';
import { events } from '../events.js';
import { bus } from '../runtime/bus.js';
import type { Violation } from '../runtime/guard.js';
import { Sentry, log, metric } from './telemetry.js';

// Invariant monitors: each one is a rule the system promises to keep. A breach is an issue, not a log line.

/** The guard caught a message that would have revealed a private bound or a forbidden token. */
export class PrivacyLeakError extends Error {
  name = 'PrivacyLeakError';
}
/** An agent tried to message someone it has no relevant edge to (gossip / spam / probing). */
export class GossipViolationError extends Error {
  name = 'GossipViolationError';
}
/** A malformed or stale-version envelope reached the bus. */
export class BusContractError extends Error {
  name = 'BusContractError';
}
/** A negotiator tried to send, or received, a price outside its user's bounds. Must never happen. */
export class BoundsViolationError extends Error {
  name = 'BoundsViolationError';
  constructor(message: string, readonly linkId: string, readonly side: string) {
    super(message);
  }
}

const VIOLATIONS: Record<Violation['rule'], { error: new (m: string) => Error; level: Sentry.SeverityLevel }> = {
  content: { error: PrivacyLeakError, level: 'fatal' },
  addressee: { error: GossipViolationError, level: 'error' },
  schema: { error: BusContractError, level: 'error' },
  version: { error: BusContractError, level: 'warning' },
};

function onViolation(violation: Violation, env: Envelope): void {
  const type = String(env.body?.type ?? 'unknown');
  const spec = VIOLATIONS[violation.rule];
  metric.count('bus.violation', { rule: violation.rule, message_type: type });
  Sentry.withScope((scope) => {
    scope.setLevel(spec.level);
    scope.setFingerprint(['bus-violation', violation.rule, type]);
    scope.setTags({ 'bus.rule': violation.rule, 'bus.message_type': type });
    // Intent ids only: the body may be exactly the leak we just stopped.
    scope.setContext('bus', { from: violation.from, to: violation.to, envelopeId: env.id });
    Sentry.captureException(new spec.error(`Bus guard blocked a ${type} message (${violation.rule})`));
  });
}

export function reportBoundsViolation(error: BoundsViolationError): void {
  metric.count('negotiation.bounds_violation', { side: error.side });
  Sentry.withScope((scope) => {
    scope.setLevel('fatal');
    scope.setFingerprint(['bounds-violation', error.side]);
    scope.setTags({ 'negotiation.side': error.side });
    scope.setContext('negotiation', { linkId: error.linkId });
    Sentry.captureException(error);
  });
}

export function reportNegotiationOutcome(input: { linkId: string; state: string; reason?: string; rounds: number; pendingUser?: boolean; durationMs: number }): void {
  const attrs = { state: input.state, reason: input.reason ?? 'none', pending_user: Boolean(input.pendingUser) };
  metric.count('negotiation.outcome', attrs);
  metric.dist('negotiation.rounds', input.rounds, 'none', attrs);
  metric.dist('negotiation.duration', input.durationMs, 'millisecond', attrs);
  if (input.reason !== 'timeout') return;
  // A session that times out means one side's agent went quiet mid-negotiation.
  log.warn('Negotiation stalled', { link_id: input.linkId, rounds: input.rounds, duration_ms: Math.round(input.durationMs) });
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setFingerprint(['negotiation-stalled']);
    scope.setContext('negotiation', { linkId: input.linkId, rounds: input.rounds, durationMs: Math.round(input.durationMs) });
    Sentry.captureMessage('Negotiation stalled until timeout');
  });
}

export function reportBudgetExhausted(where: string): void {
  metric.count('engine.budget_exhausted', { where });
  log.warn('Arrangement search budget exhausted', { where });
}

// Deal funnel: candidate -> priced -> proposed -> approved -> committed, plus why deals die.
const born = new Map<string, number>();
const funnel = (stage: string) => ({ arrangementId }: { arrangementId: string }): void => {
  metric.count('deal.funnel', { stage });
  if (stage === 'candidate') born.set(arrangementId, Date.now());
  if (stage === 'committed') {
    const start = born.get(arrangementId);
    if (start !== undefined) metric.dist('deal.time_to_commit', Date.now() - start, 'millisecond');
    born.delete(arrangementId);
    log.info('Deal committed', { arrangement_id: arrangementId });
  }
};

let installed = false;
export function installMonitors(): void {
  if (installed) return;
  installed = true;
  bus.onViolation(onViolation);
  events.on('intent.opened', () => metric.count('deal.funnel', { stage: 'intent_opened' }));
  for (const stage of ['candidate', 'priced', 'proposed', 'approved', 'committed'] as const) {
    events.on(`arrangement.${stage}`, funnel(stage));
  }
  events.on('arrangement.dissolved', ({ arrangementId, reason }) => {
    born.delete(arrangementId);
    metric.count('deal.funnel', { stage: 'dissolved', reason: reason ?? 'unknown' });
  });
  events.on('negotiation.awaiting_user', ({ side }) => metric.count('negotiation.awaiting_user', { side: side ?? 'unknown' }));
  events.on('notify', ({ kind }) => metric.count('notify.sent', { kind }));
}
