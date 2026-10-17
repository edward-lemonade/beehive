# Slice 07 TODOs: Arrangements, Approval, and Commit

## Goal
The coordinator record: turn closed sets into arrangements, price them (Slice 06), freeze terms, collect approvals, repair with replacements, and commit atomically. Bookkeeping, not an agent.

Spec: `_docs/07_arrangements_approval_commit.md`. Depends on Slices 01, 04, 05, 06. Feeds 08 and 09.

## Decisions to confirm before coding
- [x] Commit concurrency test needs a real Postgres. Use your local instance (guarded so it skips when `DATABASE_URL` is unreachable) and clean up its own rows. Recommended.
- [x] Slice 08 is not built, so SMS is out of scope. This slice emits `notify` events (`approval_request`, `dissolved`, `committed` with per-pair contacts) and exposes service functions that web and SMS will both call.
- [x] `reply_codes` belongs to Slice 08; only create it here if you want it up front. Default: leave it to 08.
- [x] `approve` before a user has a verified phone: the web path is allowed; phone gating is a Slice 08 concern.

## Workstream 1: storage
- [x] Migration `005_arrangements.sql`:
  - [x] `arrangements` (id, key, state, revision, dropped_reason, dissolved_reason, created_at, updated_at, expires_at).
  - [x] `arrangement_slots` (arrangement_id, intent_id, intent_version, approval state, approval terms hash, requested_at, decided_at).
  - [x] `arrangement_links` (arrangement_id, link_id, a, b, payer, amount_cents, state, flows JSON).
  - [x] `declined (user_id, arrangement_key)` primary key.
  - [x] Partial unique index so only one non-terminal arrangement exists per key.
- [x] Repositories (PostgreSQL plus in-memory for tests), following the signals pattern.
- [x] Add `fulfilled` to the approval states used by commit, and extend `slotSchema` in contracts; run `bash scripts/sync-contracts.sh`.
- [x] No new required env vars; document anything optional in `.env.example`.

## Workstream 2: terms view and checklist (pure)
- [x] `termsView(arrangement, participantId)`: gives and gets with counterparty handles, cash in and out per counterparty, difference from declared net, grade (`exact` or `within_tolerance`), and an "other participants you will not deal with" count.
- [x] Assert no foreign intent id, handle, item or amount appears in a participant's view (unit test across S1, a star and a 4-chain).
- [x] Arrangements worse than `minNetCents` can never reach `proposed`.
- [x] Terms hash so approvals carry across revisions when terms are identical or cash is better for the approver.
- [x] `checklist.ts`: give, get, cash out, cash in, receive-before-give ordering for multi-link participants; steps marked done through a service function.

## Workstream 3: service and coordinator
- [x] `service.ts`: `createCandidate`, `price`, `propose`, `dissolve`, `revise`, all moving the state machine `candidate -> proposed -> committed`, with `dropped` and `dissolved` terminal.
- [x] `coordinator.ts`: on `signal.changed` (debounced 250 ms, using the scheduler's `coalesceMs` pattern) load signals and edges, call `findClosedSets` and `buildArrangement`, skip known keys (open, committed, declined).
- [x] Insert candidate, call `priceArrangement`, freeze amounts on `agreed`, run `agent.precheck(terms)` per participant; any failure drops the candidate.
- [x] Move to `proposed`, create approval rows (pending cap of 3 per user, extras `queued`), emit `notify { kind: 'approval_request' }` per user.
- [x] Set `hooks.hasPendingArrangement` and `hooks.coordinatorRecipients` (Slice 05 hooks) so dormant detection and coordinator envelopes work.
- [x] Rehydrate on restart: reload non-terminal arrangements, restart pricing for unfinished candidates, re-arm approval timers from their stored deadlines.
- [x] Wire `startCoordinator()` into `src/index.ts` (skipped under VITEST) and the registry's start/stop.

## Workstream 4: approvals
- [x] `approvals.ts`: `request`, `approve`, `decline`, `declineAndWithdraw`, `retract` (until commit), `negotiateFurther`, `void`, `timeout`. One set of functions for web and SMS.
- [x] 24 simulated hour window via `clock.after`; timeout becomes `timed_out` and counts as a decline.
- [x] Declines write to `declined` so the same key is never asked again; promote the next `queued` approval when a slot frees up.
- [x] Voiding on `intent.updated` for a participant, then revalidate and replace or dissolve.
- [x] Authorization: only the slot's owner can act on it.

## Workstream 5: replacement
- [x] `vacateSlot(arrangementId, intentId, reason)` as the single entry for decline, timeout, retraction, withdrawal, expiry, version change and consumption.
- [x] `replacement.ts`: call `findReplacement` among directly relevant Open intents of the former counterparties; a decliner never fills its own vacated slot.
- [x] Price affected links starting from the old amounts; neighbors' terms must be identical or better.
- [x] On success create revision N+1; unchanged approvals carry over; only the new participant is asked; neighbors are not messaged.
- [x] If nothing is found within 24 simulated hours, dissolve with a reason and send `notify { kind: 'dissolved' }` once to previously approved users.
- [x] A vacated middle slot lets signals recompute so the coordinator can form a new set; approvals carry only where terms are identical.
- [x] Listen to `slot.vacated`, `intent.updated`, `intent.closed` and expiry events.

## Workstream 6: commit
- [x] `commit.ts`: one Postgres transaction that locks all participating intent rows `FOR UPDATE` in id order.
- [x] Check that every intent is Open at the approved version, every approval is valid, the arrangement is still `proposed` at the same revision, and no intent was consumed.
- [x] Set intents `done`, arrangement `committed`, approvals `fulfilled`.
- [x] Dissolve every other arrangement containing those intents with reason `consumed`, and enqueue replacement attempts.
- [x] Build checklists and contact releases per counterparty pair only (A gets B, B gets A and C, C gets B), reading `users.phone` inside the transaction.
- [x] Publish `arrangement.committed` and notifications only after the commit succeeds, never inside the transaction.
- [x] A failed check rolls back and either returns to collecting approvals or dissolves, depending on the check.
- [x] Emit `intent.closed` for each consumed intent so discovery and agents clean up (Slices 03 and 05).

## Workstream 7: routes
- [x] `GET /arrangements/mine` returns only the caller's terms views.
- [x] `POST /arrangements/:id/approve`, `decline`, `retract`, `negotiate-further`, `decline-withdraw`, all auth-required and slot-owner-only.
- [x] 404 for unknown ids and 403 for non-participants without leaking the arrangement's existence or contents.
- [x] Mount the router in `src/index.ts`.

## Workstream 8: tests
- [x] S1 end to end with a mocked notifier: A, B, C open in order, one arrangement is proposed, all approve, one commit. A's contacts include only B, B's include A and C, C's include only B.
- [x] S2: C declines, D fills at the same terms, new revision, only D is asked, A and B approvals carry, commit succeeds.
- [x] S3: no replacement within the window, the arrangement dissolves, A and B are told once.
- [x] S4: A is in two arrangements, one commits first, the other dissolves as `consumed`.
- [x] A declined key is never re-proposed until a version changes.
- [x] Approval timeout, retraction before commit, and approval voiding on `intent.updated`.
- [x] Pending cap of 3 with `queued` promotion.
- [x] Terms view for A never includes C's handle or any C intent id.
- [x] 20 concurrent commit attempts on overlapping intents against real Postgres: exactly one wins per intent, no deadlock.
- [x] Route auth tests: 401 without auth, 403 for non-participants.

## Verification
- [x] `npx tsc --noEmit`, `npx vitest run`, `npm run build` (backend and frontend), `git diff --check`.
- [x] Run `npm run db:migrate` for `005_arrangements.sql`.
- [x] Run `bash scripts/sync-contracts.sh` after contract changes.
- [x] Add implementation notes to this file when done.

## Out of scope
- SMS delivery, reply codes and phone verification (Slice 08).
- Map and approval UI (Slice 09).
- Sentry capture (Slice 10).
- Freshness checks, revision caps and reliability penalties for late retraction (cut for the demo).

## Implementation notes
- Migration `005_arrangements.sql` adds `arrangements`, `arrangement_slots`, `arrangement_links`, `declined`. No new env vars.
- Non-participants and unknown ids get 404 rather than 403, so existence is not leaked.
- The terms hash covers items only. Cash differences are checked via approved net.
- Replacement runs only when exactly one slot is vacated. It reuses the old amounts through `precheck` and carries approvals. With more vacancies, the replace window decides.
- `version_changed`, `withdrawn`, `expired` and `consumed` vacate as `void` and are not barred from refilling. Declines, timeouts and retractions are remembered in `declined`.
- A dropped arrangement's key stays blocked by the partial unique index.
- Commit is atomic in Postgres (intent row locks in id order, then arrangement). Memory uses a mutex. Contacts are fetched just after the commit transaction.
- Coordinator envelopes are not sent yet. SMS, reply codes and phone gating are Slice 08.
- Tests: `arrangements.test.ts` (15) and `arrangements.pg.test.ts` (real-Postgres concurrent commits, skipped if unreachable). Full suite 115 passing.
