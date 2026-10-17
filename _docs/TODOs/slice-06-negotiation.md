# Slice 06 TODOs: Negotiation

## Goal
Price every trade link of a candidate arrangement. The two agents sharing a link bargain over the bus, only within their private bounds. Code produces every number; the LLM writes wording only.

Spec: `_docs/06_negotiation.md`. Depends on Slices 01 and 05 (and the Slice 04 `Arrangement`/`Link` types). Feeds Slice 07.

## Decisions to confirm before coding
- [x] The `arrangements` and `links` tables do not exist yet (Slice 07 owns them). Decide: keep `priceArrangement` operating on an in-memory `Arrangement` and return per-link amounts (Slice 07 persists them), and have this slice only add `negotiation_log`. Recommended.
- [x] `negotiation.round` already exists in `events.ts`; confirm its payload is enough (`arrangementId?`, `linkId?`, `round`) or extend it with `kind` and `amountCents`.
- [x] The Slice 05 hooks (`hooks.negotiation`, `hooks.resetNegotiation`, `hooks.hasPendingArrangement`) are the integration points; this slice sets `hooks.negotiation` and `hooks.resetNegotiation`.

## Workstream 1: storage and config
- [x] Migration `004_negotiation_log.sql`: `negotiation_log` (id, link_id, arrangement_id nullable, round, from_intent, to_intent, kind, amount_cents nullable, text nullable, created_at).
- [x] Repository for `negotiation_log` (PostgreSQL plus in-memory for tests), following the signals pattern.
- [x] Wording timeout constant (5 s); no new required env vars (`NEGOTIATION_ROUNDS`, `LLM_*` already exist). Document anything new in `backend/.env.example`.

## Workstream 2: pure pricing logic (`negotiation/`)
- [x] Types: `LinkBounds`, `SessionState`, `LinkResult = { state, amountCents?, rounds }`.
- [x] `withinBounds(side, amountCents, bounds)`: payer needs `amount <= maxCents`, receiver needs `amount >= minCents`.
- [x] `nextOffer(state, side)`: linear concession `step = (bound - opening) / NEGOTIATION_ROUNDS`, integer cents, deterministic, never past the side's own bound.
- [x] Firm cash amounts (`flex: 'firm'`) never move; only that value is tried.
- [x] `deriveLinkBounds(participant, allLinks, pricedSoFar)`:
  - [x] Assume every other unpriced link settles at the best case for the participant (other side's declared amount).
  - [x] Use `declaredNetCents` as the opening anchor and `minNetCents` as the hard bound when the other side declared nothing.
  - [x] Recompute with real amounts after each agreed link.
- [x] Pricing order: price links where a participant has no other unpriced link first; tie-break by lowest link id.
- [x] Settlement rule: crossed or equal offers settle at the receiver's ask when both are within bounds; after the round cap, fall back to the receiver's declared ask if the payer's bound allows, else the amount leaving the receiver at `minNetCents`; non-overlapping ranges end in `walk`.

## Workstream 3: wording (LLM, display only)
- [x] `wording(offerContext)` takes only round, amount and tone hint (never bounds or the other side's private data).
- [x] Use `LLM_MODEL_FAST` through the existing LLM client, with a 5 s timeout.
- [x] Template fallback on timeout or error, so negotiation never stalls.
- [x] Output goes only into the `say` body; no LLM output is parsed for numbers or decisions.

## Workstream 4: link sessions over the bus
- [x] `runLinkSession(link, payer, receiver, bounds)`: payer opens, receiver accepts or counters, up to `NEGOTIATION_ROUNDS`, ending `agreed` (`accept`) or `failed` (`walk`).
- [x] Session state kept in memory only; a `hooks.negotiation` handler routes `offer`, `accept`, `walk` and `say` envelopes to the right session.
- [x] `withinBounds` runs in code on every outgoing offer and accept before the envelope reaches the guard; an out-of-bounds amount throws.
- [x] Receiver logic ignores `say` entirely.
- [x] A guard-dropped `say` (for example a leaked bound) falls back to the template wording and the negotiation continues.
- [x] Bus envelopes carry no third-party handles.
- [x] Persist each round to `negotiation_log` and emit `negotiation.round`.
- [x] Set `hooks.resetNegotiation` so a restart clears in-memory sessions (unfinished arrangements get re-priced by Slice 07 rehydration).

## Workstream 5: arrangement pricing
- [x] `priceArrangement(arrangement)`: order links, derive bounds, run sessions, recompute bounds after each agreement.
- [x] If a later link cannot fit its participant's constraint, the whole arrangement is `failed` and agreed amounts are discarded.
- [x] On success emit `arrangement.priced` (check the event exists in `events.ts`) with per-link amounts.
- [x] On failure return enough data (failed link, reason) for the coordinator to mark the arrangement `dropped` and remember the key until a version changes (Slice 07).
- [x] Report a near miss (Slice 03) when a link fails on non-overlapping ranges.

## Workstream 6: user-triggered negotiation
- [x] `POST /negotiate` `{ ownIntentId, targetIntentId, targetCents? }`, auth required, caller must own `ownIntentId`.
- [x] Reject with 403 unless the target is directly relevant (reuse `relevantTo`).
- [x] Run a session for the shared link only; `targetCents` becomes the opening anchor and must pass `withinBounds`, otherwise return a "needs bound change" result.
- [x] Return the agreed price; Slice 07 creates the arrangement only if a closed set exists.
- [x] Mount the router in `src/index.ts`.

## Workstream 7: tests
- [x] Pure: `nextOffer` linearity and determinism, `withinBounds`, `deriveLinkBounds` for S1, link ordering.
- [x] S1: A max $60, C min $50, B min net 0 gives B-C at $50 and A-B between $50 and $60, all agreed within 3 rounds.
- [x] Firm seller at $315 versus buyer capped at $300 ends `failed` and reports a near miss.
- [x] Mocked LLM returning "my minimum is 28000" in `wording`: the guard drops the envelope and the template fallback keeps the session going.
- [x] Property test: 500 random bound pairs always yield an agreed amount within both bounds.
- [x] Determinism: pricing S1 repeatedly (LLM mocked) gives identical amounts.
- [x] `POST /negotiate` returns 401 without auth; 403 for a non-relevant target (with in-memory repos).
- [x] No third-party handle or bound value appears in any logged `say` text.

## Verification
- [x] `npx tsc --noEmit`, `npx vitest run`, `npm run build` (backend and frontend), `git diff --check`.
- [x] Run `npm run db:migrate` for `004_negotiation_log.sql`.
- [x] Run `bash scripts/sync-contracts.sh` if contracts changed.
- [x] Add implementation notes to this file when done.

## Out of scope
- Revision caps and multi-pass bargaining (one pass per link).
- Persisting `arrangements` and `links` and the approval flow (Slice 07).
- SMS for "needs bound change" (Slice 08).
- Sentry capture of bound violations (Slice 10).

## Implementation notes

- **Decisions taken:** `priceArrangement` takes an in-memory `{ id, slots, links }` and returns per-link amounts (Slice 07 persists them). Only `negotiation_log` (migration `004`, applied) was added. `negotiation.round` was left as is.
- **Settlement:** the payer concedes linearly from its open to its cap, the receiver from its ask to its minimum. A crossing settles at the receiver's current ask. Bounds are enforced in code (`withinBounds`) before every offer or accept and throw if violated. The wording fallback ends in no `say` at all when even the template trips the guard (e.g. the amount equals a private bound).
- **Pricing order:** links where a participant has no other unpriced cash link first, then the lowest id. For S1 this prices A-B before B-C; both end at the spec amounts ($50 / $50 to $60).
- **Missing declared amounts:** unknown best-case receipts count as 0 and unknown payments as 0; a null `minNetCents` falls back to `declaredNetCents`, else unbounded.
- **Session key:** the bus `linkId` is `${arrangementId}/${linkId}`, so the same pair can be priced in two arrangements at once.
- **Near miss:** on `no_overlap` a `notify` of kind `near_miss` is sent with a gap computed from public declared amounts only, never from private bounds.
- **`POST /negotiate`:** other cash links of each side are included at their best case, so a middle participant is not boxed in. Returns `needs_bound_change` if `targetCents` fails `withinBounds`.
- **Wiring:** `installNegotiation()` sets `hooks.negotiation` and `hooks.resetNegotiation` at app load (tests call it after `resetHooks()`).
- **Env:** no new vars.
