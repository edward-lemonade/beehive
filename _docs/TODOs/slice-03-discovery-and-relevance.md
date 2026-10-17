# Slice 03 TODOs: Discovery and Relevance

## Goal
For any Open intent, find its neighborhood, decide which intents are directly relevant, record what was read, and detect near misses. Reads public parts only, with no LLM and no free text.

## Workstream 1: contracts and storage
- [x] Add `RelevantEdge` and `NearMiss` Zod schemas to backend contracts and sync them to the frontend with `scripts/sync-contracts.sh`.
- [x] Reuse the existing `EdgeCover` and `Flow` contracts (`Flow` moved above `RelevantEdge` in the contracts file).
- [x] Add migration `002_notices.sql` with a `notices` table keyed by `(observer_intent, intent)` with `observer_version` and `version` columns (stale rows are overwritten) storing `relevant`, the computed edge data, and timestamps. Additive and `IF NOT EXISTS`.
- [x] Add a notices repository (PostgreSQL) plus an in-memory implementation for tests, following the Slice 02 repository pattern.
- [x] Add a repository method to delete notices that reference a closed intent.
- [x] Decide what "same community" means now: there is no community concept yet, so neighborhood is all Open intents. Document this as the current behavior.

## Workstream 2: pure matching (`discovery/`)
- [x] Implement `itemMatch(given, wanted)`: equal `kind`, equal normalized `label`, every wanted attr satisfied, and given `qty` at least wanted `qty`.
- [x] Implement sublet date containment for `dateStart`/`dateEnd` (wanted range inside offered range).
- [x] Implement `directlyRelevant(x, y)` returning a `RelevantEdge` or `null`. Cash alone never counts.
- [x] Keep `directlyRelevant` and `itemMatch` pure (no DB, no clock) so Slice 04 can build edges from fixtures.
- [x] Unit-test matching: exact match, attr mismatch, qty shortfall, label normalization, sublet containment and partial overlap, `anyOf` alternatives, cash-only exclusion.

## Workstream 3: neighborhood and edges
- [x] Implement `getNeighborhood(intentId)`: Open intents, not the caller's own user, with no geographic filtering.
- [x] Implement `refreshEdges(intentId)`: run relevance against the neighborhood, write one notice per `(observer, intent, version)` including `relevant = false`, and emit `edges.changed`.
- [x] Skip intents already judged not relevant at the same version.
- [x] Implement `getEdges(intentId)` returning only edges whose `otherVersion` equals the other intent's current version.
- [x] Test that editing an intent's item label removes the stale edge on the next `edges.changed`.

## Workstream 4: wake triggers
- [x] On `intent.opened`: refresh the new intent and every neighbor.
- [x] On `intent.updated` with `privateOnly = false`: refresh the intent and every intent holding a notice for it. Ignore `privateOnly` updates.
- [x] On `intent.closed`: delete notices referencing it, then emit `edges.changed` for each intent that had it as relevant.
- [x] Coalesce bursts per intent over 250 ms of real time.
- [x] Add the periodic safety re-check for all Open intents every 5 simulated minutes, using the shared clock, re-reading only changed versions.
- [x] Register listeners on app startup in `src/index.ts` without breaking the existing health and route tests.
- [x] Test each trigger with the in-memory repository and fake timers.

## Workstream 5: near misses
- [x] Implement `detectNearMisses(intentId)` using public parts only.
- [x] Detect `price` misses: items match but declared cash does not.
- [x] Detect `dates` misses: sublet items match except for partial date overlap.
- [x] Return only the single nearest miss per kind.
- [x] Generate text that never includes handles, names, or free text; handles appear only in structured fields.
- [x] Rate limit near-miss delivery (`deliverableNearMisses`, used by Slice 08) to 1 per kind per 24 simulated hours unless the gap changes. The route always returns current near misses.
- [x] Test the documented example: seller at $315, buyer at $300.

## Workstream 6: routes
- [x] `GET /intents/:id/near-misses`: caller's near misses for one of their own intents; 403 for other users' intents, 404 for unknown.
- [x] `GET /intents/:id/relevant`: returns only `{ relevant, ownIntentId }` for a public intent. True only if directly relevant to one of the caller's Open intents.
- [x] Both routes behind `requireAuth`; add tests that unauthenticated requests get 401 and responses expose nothing beyond the documented fields.

## Workstream 7: acceptance and regression checks
- [x] S1 fixture: A (wants ticket1, pays cash), B (gives ticket1, wants ticket2), C (gives ticket2, wants cash). A and C are never relevant to each other; B is relevant to both.
- [x] A cash-only buyer is relevant to a ticket seller; two ticket sellers are not relevant to each other.
- [x] Sellers with matching items are not geographically filtered.
- [x] `refreshEdges` over 200 seeded intents completes in under 500 ms.
- [x] Public-only guarantee: no code path in `discovery/` reads `private` or free text.
- [x] Backend build, all tests, and `git diff --check` pass.

Status: implemented. Live token-authenticated route checks are deferred to Slice 09 with the rest of Clerk testing.

## Dependencies
- Depends on: Slice 01 (contracts, events, clock) and Slice 02 (intents, versions, `intent.*` events).
- Feeds: Slice 05 (agent runtime and bus), Slice 04 (engine fixtures), Slice 08 (near-miss SMS), Slice 09 (relevance and near-miss routes in the feed).

## Notes
- Edges are symmetric as a pair, but each side stores its own `selfWants` and `selfGives` view.
- Location and radius are not part of the current intent model, so there is no geographic filtering. Revisit when location is added.
- Splitting a quantity across several providers is Slice 04, not here.
- Environment: no new settings are expected. If any are added, update `backend/.env.example` as well.
