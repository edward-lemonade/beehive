# Slice 05 TODOs: Agent Runtime and Bus

## Goal
One lightweight agent per Open intent, woken by events, exchanging satisfiability signals only through a guarded in-process bus that enforces the no-gossip rule.

## Workstream 1: storage and config
- [x] Add migration `003_signals.sql` with a `signals` table keyed by `(from_intent, to_intent)` storing `from_version`, `to_version`, `satisfiable` and `updated_at`.
- [x] Add a dev-only `bus_log` table (or in-memory ring buffer) for debugging; make the content copy configurable and off in production.
- [x] Add a signals repository (PostgreSQL plus in-memory for tests), following the Slice 03 notices pattern.
- [x] Add `SEARCH_BUDGET_EXPANSIONS` and `SEARCH_BUDGET_MS` to config if they are not already there (the constants exist in contracts), and document them in `backend/.env.example` if added.
- [x] Add `signalsForIntent`, `upsert` and `deleteForIntent` repository methods.

## Workstream 2: bus and guard
- [x] `runtime/bus.ts`: `send(envelope)` and `subscribe(intentId, handler)` with an in-memory queue and per-recipient ordering.
- [x] `runtime/guard.ts`: reject and report (never sanitize) with typed violations `{ rule, from, to }`.
  - [x] Addressee check: `env.to` must be in the sender's current relevant edges; coordinator envelopes skip it but must target a slot in the named arrangement.
  - [x] Strict schema check against `BusBody` (no extra keys); the current `busBodySchema` union is not strict, so tighten it.
  - [x] Content check: no sender `minNetCents`, its negation, or any bound value (digits, `$`, commas) in any string; no other intent's id or handle except the recipient's.
  - [x] Version check: `signal` versions match current versions.
- [x] Every envelope carries a `trace` slot (`sentryTrace`, `baggage`); leave it empty until Slice 10.
- [x] Log every delivered and dropped message to the bus log.
- [x] Guard unit tests: non-relevant addressee, `say` containing the bound number (several formats), extra body key, stale version, handle leak.

## Workstream 3: agent
- [x] `runtime/agent.ts`: `Agent { intentId, wake(reason), onMessage(env), precheck(terms) }`.
- [x] `wake`: load own intent and `getEdges`, load incoming signals, run `localStatus`, diff against the last status sent to each neighbor, and send a `signal` only to neighbors whose status changed. Persist each one.
- [x] Emit `signal.changed` after sending so Slice 07 can look for closed sets.
- [x] Dormancy: with no relevant neighbors or covers and no pending arrangement, compute near misses and emit `notify { kind: 'nothing_found' }` once per intent version; set `dormant` and clear it on any later wake.
- [x] `onMessage`: `signal` upserts and wakes; `offer`, `accept`, `walk` and `say` are forwarded to a negotiation hook (a stub until Slice 06).
- [x] `precheck(terms)` returns `{ ok, reason }`, checking: net cash against `minNetCents`, items and quantities, deadline, and the intent still Open at the same version. Radius is skipped (locations are not a feature yet).
- [x] Tests: S1 signals fan out as specified and are never addressed A-to-C.

## Workstream 4: scheduler and registry
- [x] `runtime/scheduler.ts`: wake sources `edges.changed`, `signal.changed` for the recipient, `intent.updated` for the owner, the Slice 03 periodic check, and a manual "keep looking".
- [x] Coalesce wakes per intent over 250 ms of real time.
- [x] Serialize wakes per intent while running different agents concurrently.
- [x] Pass `SEARCH_BUDGET_EXPANSIONS` and `SEARCH_BUDGET_MS` into the Slice 04 calls and count every budget exhaustion for Slice 10.
- [x] Yield with `setImmediate` between agents so a wake burst does not block HTTP.
- [x] `runtime/registry.ts`: create agents on `intent.opened`, destroy on `intent.closed`.
- [x] Add a manual "keep looking" route or hook (decide with Slice 09 whether this is a route now).

## Workstream 5: retraction and rehydration
- [x] Retraction: when an intent leaves Open or changes version, send `satisfiable: false` signals to every neighbor it had signaled, persist them, then destroy the agent.
- [x] `runtime/rehydrate.ts`: on boot load Open intents, create agents, and `wake('boot')`; recompute signals and skip unchanged ones.
- [x] Wipe in-memory negotiation sessions on boot; link-state reset is wired up with Slice 07.
- [x] Call rehydration from `src/index.ts` outside tests.
- [x] Tests: restart simulation reproduces the same statuses and signals with no duplicate sends.

## Workstream 6: acceptance
- [x] Seeded S1: after C opens, B signals A and C, A and C signal B, and the bus log has no A-to-C message.
- [x] Removing C makes B retract toward A, and A's status goes false.
- [x] 200 seeded intents settle from one wake burst in under 3 seconds real time.
- [x] No agent or bus code reads another intent's private data.
- [x] Backend build, all tests and `git diff --check` pass.

## Dependencies
- Depends on: Slice 01 (events, clock, contracts), Slice 03 (`getEdges`, `refreshEdges`, near misses) and Slice 04 (`localStatus`, closed sets).
- Feeds: Slice 06 (negotiation messages), Slice 07 (`signal.changed`, replacement), Slice 10 (violations, budget counts, trace slots).

## Notes
- Needs a new migration for `signals` (and `bus_log` if persisted); apply it to the local database as before.
- The Slice 04 engine `localStatus` expects signals in the shape of `Signal`; the agent maps stored rows into it, dropping any whose versions are stale.
- Open question: the existing `intent.updated` privateOnly edits change `minNetCents` but not public terms. They should not retract signals; only public-version changes should. Confirm when implementing.

## Implementation notes

- **Optimistic signals:** a missing or stale incoming signal counts as `satisfiable: true`, so chains and cycles settle on the greatest fixed point instead of deadlocking.
- **Wake sources:** `signal.changed` is not a wake source. The bus delivery to the recipient already wakes it.
- **Slice 03 fix:** `editIntent` bumps the version even on private-only edits, so discovery now refreshes on every `intent.updated`. The discovery test was updated.
- **Guard context:** the bus gets it through a provider (`bus.setGuardContext(buildGuardContext)`), which keeps the guard pure.
- **Slice 07 hooks:** `runtime/hooks.ts` exposes `hasPendingArrangement`, `coordinatorRecipients`, `negotiation` and `resetNegotiation`. Coordinator envelopes are rejected until Slice 07 sets them.
- **Budget:** `searchBudget()` and `noteBudget()` are ready for Slice 07 and unused here.
- **Migration:** `003_signals.sql` is applied.
- **Env:** no new required vars; `BUS_LOG_CONTENT` is optional.
