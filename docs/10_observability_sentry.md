# 10 Observability (Sentry)

**Spec:** 1 (hackathon fit), principles 3, 9, 10, G7. **Depends on:** 01. Adds hooks in 02, 05, 06, 07. **Purpose:** the Sentry challenge entry.

Goal: make the agent system visible. One trace per wake-up chain, a dashboard of agents, and monitored privacy invariants that fire alerts when something leaks.

## Setup
- `backend/src/instrument.ts` initializes Sentry and must be imported first in the entry file. Enable tracing (`tracesSampleRate: 1.0` for the hackathon). Keep `vercelAIIntegration` on (default with tracing) so every `ai` call becomes a `gen_ai` span. Use `@sentry/node` 10.6.0 or newer.
- Give every LLM call a `functionId` via `experimental_telemetry` so spans are readable: `intent.parse`, `negotiation.wording`, `sms.classify`.
- Do not also register the AI SDK's own telemetry registry, or spans duplicate.
- Web: `@sentry/react` with browser tracing, and `tracePropagationTargets` set to the API origin so frontend actions join the backend trace.
- Source maps upload for web in the Vercel build.
- Tag scope with `intent_id`, `arrangement_id`, `user_handle` (never phone or free text).

## One distributed trace per wake-up chain (`observability/tracing.ts`)
- Each agent is a "service": wrap `Agent.wake()` in a span with `op: 'gen_ai.invoke_agent'` and attribute `gen_ai.agent.name = 'agent:<handle>'`. This populates Sentry's AI Agents view with one row per user agent.
- Child spans: `relevance.filter` (attributes `read`, `relevant`, `nearMisses`), `signals.compute`, `signals.send`, `engine.closedSets` (attributes `components`, `budgetExhausted`), `negotiation.link` (attributes `rounds`, `result`), `negotiation.round`, `arrangement.commit`.
- **Propagation across the bus:** when sending an envelope, set `trace.sentryTrace` and `trace.baggage` from the active span (`Sentry.spanToTraceHeader`, `Sentry.spanToBaggageHeader`). On receive, call `Sentry.continueTrace` and start the handler span inside it. The result is one waterfall: C opens, B wakes, A wakes, coordinator closes the loop, negotiation rounds, approval, commit.
- A root span named `intent.opened` starts the chain. Replacement chains start from `slot.vacated`.
- Add a helper `withSpan(name, attrs, fn)` so slices call one function instead of Sentry directly.

## Invariant monitors
These are the creative part. Each one captures a Sentry event with a stable fingerprint and tags.

**1. Privacy-leak canary (`canary.ts`).** The bus guard (slice 05) calls `reportViolation` on any rejected envelope:
- Content leak (bound value in a body): `captureException(new PrivacyLeakError(...))`, level `fatal`, tags `rule=content`, `from`, `to`.
- Never include the leaked value in the event. Include only the rule, the field name, and the ids.
- Also run the check on outbound SMS (slice 08) and on every API response for other users' routes: scan for the viewer's own private values and for foreign intent ids in arrangement terms (slice 07). A hit is the same event type.

**2. No-gossip invariant.** Guard rule 1 (addressee not in relevant edges) captures `GossipViolationError`, level `error`. This is the monitored form of principle 10.

**3. Injection detector.** When the parser sets `injectionSuspected` (slice 02), call `captureMessage('injection suspected', 'warning')` with tags `author_handle`, `intent_id`, and the model-provided reason. The intent is still parsed structurally and shown, but flagged in the dashboard.

**4. Out-of-bounds offer.** `withinBounds` failure in slice 06 captures `BoundsViolationError`. It should never fire. If it does, a test is missing.

**5. Stuck-negotiation detector.** A link session open longer than 60 simulated seconds, or an arrangement in `candidate` or `proposed` beyond its window without a state change, captures a warning with the arrangement id.

**6. Budget exhaustion.** `budgetExhausted: true` from the engine captures a warning with the component size.

## Metrics (check the installed SDK exposes `Sentry.metrics`)
Counters: `agent.wake`, `signal.sent`, `arrangement.created|proposed|committed|dissolved{reason}`, `negotiation.agreed|failed`, `near_miss.sent`, `injection.suspected`, `guard.violation{rule}`.
Distributions: `negotiation.rounds`, `arrangement.size`, `search.duration_ms`, `time_to_commit_sim_ms`.

## Dashboards and alerts (set up in the Sentry UI, write the steps in `docs/sentry.md`)
- **Deal funnel:** opened intents, relevant edges, closed sets, priced, proposed, approved, committed.
- **Where deals die:** dissolved by reason (decline, timeout, consumed, withdrawn).
- **Agents:** AI Agents view filtered by project, with token usage and latency per `functionId`.
- **Alert rules:** any `PrivacyLeakError` or `GossipViolationError` (immediate), `BoundsViolationError` (immediate), injection spikes (more than 3 in 10 minutes).

## Demo hooks (dev and demo only, behind `DEMO_MODE=true`)
- `POST /demo/attack`: swaps the wording prompt for one that tells the model to reveal its user's bound. The model complies, the guard drops the message, and Sentry fires the canary alert on screen. This is the "watch it catch a leak" moment.
- `POST /demo/inject`: opens an intent whose text contains an instruction. The detector flags it and the negotiation proceeds unaffected.
- `POST /demo/stall`: pauses one agent so the stuck-negotiation detector fires.

## Acceptance
- A single trace id spans the full S1 chain, from `intent.opened` through `arrangement.commit`, with every agent wake as a child span.
- The AI Agents view lists one agent per seeded user.
- `/demo/attack` produces exactly one `PrivacyLeakError` event, the offending message is not delivered, and the event body does not contain the leaked number.
- `/demo/inject` produces one injection warning and a normal arrangement.
- Dashboard widgets render with seeded data (screenshot for the submission).

## Notes
- Sentry never receives phone numbers, free text, or private bounds. Scrub `beforeSend` and `beforeSendTransaction` to drop those fields as a second layer.
- Check Sentry's current docs for span attribute names before coding; they have changed between SDK versions.