# 03 Discovery and Relevance

**Spec:** 6.4, 6.5, 6.17, G9, G11. **Depends on:** 01, 02. **Feeds:** 05.

Goal: for any Open intent, find its neighborhood, decide which intents are directly relevant, record what was read, and detect near misses. This slice reads public parts only.

## Module API (`discovery/`)
```ts
getNeighborhood(intentId): IntentPublic[]          // same community, Open, not own, radius-compatible
itemMatch(given: Item, wanted: WantItem): boolean
directlyRelevant(x: IntentPublic, y: IntentPublic): RelevantEdge | null
refreshEdges(intentId): RelevantEdge[]             // runs the above, writes notices, emits edges.changed
getEdges(intentId): RelevantEdge[]                 // from notices, current versions only
detectNearMisses(intentId): NearMiss[]
```
```ts
RelevantEdge { self: IntentId, other: IntentId, otherVersion: number,
               selfWants: EdgeCover[],   // items other can give me
               selfGives: Flow[] }       // items I can give other
NearMiss     { otherHandle: string, gapCents: number, kind: 'price'|'dates'|'location', text: string }
```

## Rules
- **Neighborhood:** Open, not the agent's own user, community match, and radius-compatible: `haversine(coarseA, coarseB) <= min(radiusA, radiusB)`. If either is location-free, skip the distance check. Query with a bounding box on `lat, lng` first, then compute haversine in code.
- **Directly relevant (Spec 4):** ignoring cash, some item in Y's Give satisfies some item in X's Want, or the reverse. Cash alone never counts.
- **Item match:** `kind` equal, `label` equal after normalization, and every attr in the wanted item is satisfied by the given item. Equal for strings and numbers. For sublets, `dateStart`/`dateEnd` use containment (wanted range inside offered range). The given `qty` must be at least the wanted `qty` for a single flow. Splitting a quantity across several providers is handled in slice 04.
- **No LLM here.** Matching is structured and deterministic. Free text is never read.
- **Notice records:** write one `notices` row per `(observer_intent, intent, version)`, including intents judged not relevant (`relevant = false`). A not-relevant intent is never used again until its version changes.
- **Stale handling:** `getEdges` only returns edges whose `otherVersion` equals the other intent's current version.

## Wake triggers (emit `edges.changed` for affected intents)
- `intent.opened`: refresh the new intent, and every neighbor in its neighborhood (they may now see it).
- `intent.updated` (not privateOnly): refresh the intent and every intent that had a notice for it.
- `intent.closed`: delete notices that reference it, then emit `edges.changed` for each intent that had it as relevant.
- Coalesce bursts: batch wake events per intent over 250 ms real time.
- Periodic safety re-check every 5 simulated minutes for all Open intents (cheap, since only changed versions are re-read).

## Near misses
Computed during the relevance filter from public parts only:
- Same items match but declared cash does not: `price`. Example text: "Closest ticket I found is $315, you're at $300."
- Sublet items match on everything except partial date overlap: `dates`.
- Items match and price works but radius fails: `location`.
Rules:
- Text never includes handles, names, or free text. Use handle only in structured fields.
- Return the single nearest miss per kind, not a list.
- Used by slice 08 for one "nothing I can assemble" SMS and by the map side panel in slice 09 (`GET /intents/:id/near-misses`).
- Rate limit per intent (1 per 24 simulated hours unless the gap changes).

## Routes
- `GET /intents/:id/near-misses` returns the caller's near misses for one of their own intents.
- `GET /intents/:id/relevant` returns `{ relevant: boolean, ownIntentId: string|null }` for a bubble the caller is viewing. True only if that intent is directly relevant to one of the caller's Open intents. It returns nothing else about the bubble. The map (slice 09) uses it to show or hide "Message their agent".

## Acceptance
- Seeded S1 setup: A (wants ticket1, pays cash), B (gives ticket1, wants ticket2), C (gives ticket2, wants cash). A and C are never marked relevant to each other. B is relevant to both.
- A far-away seller with a matching item is excluded by radius.
- A buyer and seller of the same item are not "relevant" through cash alone: a cash-only buyer (cash give, want ticket) is relevant to a ticket seller, but two sellers of tickets are not relevant to each other.
- Editing C's ticket label makes B's edge to C disappear on the next `edges.changed`.
- `refreshEdges` on 200 seeded intents completes in under 500 ms.

## Notes
- Edges are symmetric as a pair, but each side stores its own `selfWants` and `selfGives` view.
- Keep `directlyRelevant` pure so slice 04 tests can build edges from fixtures without a DB.