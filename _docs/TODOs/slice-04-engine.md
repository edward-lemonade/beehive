# Slice 04 TODOs: Engine (Signals and Arrangement Formation)

## Goal
Pure, side-effect-free functions that turn public intents, relevance edges and signals into satisfiability statuses, closed sets and arrangement drafts. No DB, no network, no LLM, no private bounds, no prices.

## Workstream 1: types and fixtures
- [x] Add `Budget`, `ArrangementDraft` (with `budgetExhausted`) and slot id types in `backend/src/engine/types.ts`, reusing `RelevantEdge`, `Signal`, `Link`, `Flow` and `IntentPublic` from contracts.
- [x] Add a fixture builder (`test/fixtures/engine.ts`) that builds intents and edges using the Slice 03 `directlyRelevant`, so engine tests don't need a DB.
- [x] Define slots as non-cash items only; decide how a slot's identity is encoded (`w0`, `g0`) and keep it consistent with `EdgeCover.slot`.
- [x] Decide how `Budget` time is measured (real clock vs injectable) so the budget test is deterministic.

## Workstream 2: localStatus and pruneToReady
- [x] `localStatus(self, edges, incoming)`: per-slot covers from neighbors whose signal to self is satisfiable; satisfiable only if every slot has at least one.
- [x] Ignore signals whose versions are not current.
- [x] `pruneToReady(intents, edges)`: greatest fixed point using a neighbor-keyed queue, not a full rescan.
- [x] Tests: S1, chain of 4, three-way swap, retraction (removing D drops C, B, A), unsatisfiable slot.

## Workstream 3: closed sets
- [x] `findClosedSets(signals, edges, budget)`: build the ready set from current-version signals and return connected components with at least 2 intents.
- [x] Check the budget inside the search loops and set `budgetExhausted` when it runs out.
- [x] Tests: stale-version signal does not count; dense 60-intent fixture stops at budget with `budgetExhausted: true`.

## Workstream 4: buildArrangement
- [x] Seed-based provider choice preferring: already in the arrangement, then fewest uncovered slots, then better declared price for the seed (public declared amounts only).
- [x] Close the arrangement under newly added members' slots.
- [x] Respect provider `qty`, including splitting one wanted quantity across providers.
- [x] Return null when no complete assignment exists within budget.
- [x] Build `Link`s per pair exchanging a non-cash item, with flows and payer rules: one-way flow, receiver pays; two-way flow, the side giving cash pays or none; no cash between non-counterparties.
- [x] Tests: S1 links (A-B with A paying, B-C with B paying, no A-C), chain of 4 in a line, three-way swap with no cash, S10 star of 4, quantity (seller qty 4 and two buyers qty 2).

## Workstream 5: key, ranking, replacement
- [x] `arrangementKey(slots)`: sort `intentId@version`, join with `|`; test that different seeds give the same key.
- [x] `rank(a, b, viewer)`: fewer participants, then better declared net for the viewer, then higher tiers; structure only.
- [x] `findReplacement(arr, vacated, candidates, intents, edges)`: a candidate with identical items for every neighbor flow of the vacated intent; exclude candidates who previously declined this key.
- [x] Tests for replacement: matching candidate swaps in, mismatched item or prior decliner is excluded.

## Workstream 6: acceptance
- [x] All ten scenarios from the spec pass as Vitest fixtures.
- [x] Confirm no engine module imports `db`, `clock`, `events`, or reads `IntentPrivate`.
- [x] Functions are deterministic: the same input always gives the same output regardless of input ordering.
- [x] Backend build, all tests and `git diff --check` pass.

## Implementation notes
- Signatures differ slightly from the spec because slots cannot be derived from ids alone: `localStatus` takes the `IntentPublic`; `pruneToReady`, `findClosedSets` and `buildArrangement` take an `intents` map; `findClosedSets` and `buildArrangement` return `{ sets | draft, budgetExhausted }`; `findReplacement` takes an optional `declinedBy` set; `buildArrangement` takes optional `{ seed, must }`.
- Budget time is injectable via `Budget.now` (defaults to `Date.now`); expansions are the deterministic limit used in tests.
- Payer rule refinement: a one-way link's receiver pays only if the receiver gives cash or the giver wants cash. Otherwise there is no payer (required for the cash-free three-way swap while keeping S1's B-C payer).
- Slice 03 `itemMatch` requires a single provider to cover the full quantity, so real edges never request a split. The engine supports splitting (tested with hand-built edges); partial covers would need a Slice 03 change.
- A give slot counts as covered once any flow takes it; a seller with spare quantity does not drag extra buyers into the arrangement. Use `must` to force specific members.

## Dependencies
- Depends on: Slice 01 contracts (types only) and Slice 03 `RelevantEdge` and `directlyRelevant` for fixtures.
- Feeds: Slice 05 (agent runtime loops over these functions), Slice 07 (arrangements, replacement), Slice 10 (budget-exhausted alerting).

## Notes
- Nothing here needs environment variables or migrations.
- Prices are chosen in Slice 06; the engine only orders by structure.
- Open question: Slice 03 edges are built from `selfWants` and `selfGives` with one cover per want slot. Quantity splitting across several providers needs the engine to read quantities from the edge items rather than from `EdgeCover` alone.
