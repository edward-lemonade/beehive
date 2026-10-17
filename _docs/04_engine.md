# 04 Engine: Signals and Arrangement Formation

**Spec:** 6.4 (Search), 6.6, 6.10, D10, D11, G12, G22. **Depends on:** 01 (types only). **Feeds:** 05, 07.

Goal: pure functions, no DB, no network, no LLM. They take public intents, relevance edges, and signals, and return statuses and arrangements. This is the logic most worth testing, so build it first and test it hard.

## Concepts
- **Slot:** one non-cash item an intent gives or wants. An intent is **covered** when every slot has at least one neighbor that can provide or take it.
- **Ready set S:** the largest set of intents where every member has every slot covered by another member of S. This is the greatest fixed point of "is satisfiable with its neighbors." It is how chains and cycles resolve with no shared view.
- **Signals** are the distributed form of the same thing: X tells Y "I am satisfiable if you participate."

## Functions (`engine/`)
```ts
localStatus(self: Id, edges: RelevantEdge[], incoming: Signal[]): {
  satisfiable: boolean,
  covers: Record<SlotId, Id[]>        // providers whose signal to self is true
}

pruneToReady(intents: Id[], edges: Map<Id, RelevantEdge[]>): Set<Id>   // greatest fixed point

findClosedSets(signals: Signal[], edges: Map<Id, RelevantEdge[]>, budget: Budget): Id[][]
  // connected components of the ready set, respecting current versions

buildArrangement(set: Id[], intents: Map<Id, IntentPublic>, edges, budget: Budget): ArrangementDraft | null
  // picks one provider per slot, closes under newly added members, returns links and flows

arrangementKey(slots): string
rank(a: ArrangementDraft, b: ArrangementDraft, viewer: Id): number
findReplacement(arr: Arrangement, vacated: Id, candidates: Id[], intents, edges): ArrangementDraft | null
```
`Budget = { maxExpansions: number, maxMs: number }`. Both limits are checked inside the search loops. On exhaustion, return the best result so far and set `budgetExhausted: true` on the output (slice 10 raises an alert).

## Algorithms
**localStatus.** For each slot of `self`, collect neighbors that cover it and whose signal `to=self` is `satisfiable: true`. `satisfiable` = every slot has at least one. Slots are non-cash items only.

**pruneToReady.** Start with all intents. Repeatedly remove any intent with an uncovered slot (counting only members still in the set). Stop when stable. Use a queue keyed by neighbor, not a full rescan.

**findClosedSets.** Build the ready set from stored signals (a signal counts only if both versions are current). Return connected components that contain at least 2 intents.

**buildArrangement.** Pick a seed intent. For each of its slots, choose a provider from the set by preference: already in the arrangement, then fewest uncovered slots of its own, then better declared price for the seed. Add the provider, then cover the provider's slots the same way. Repeat until all members are covered. Respect quantity: a provider can serve several members until its `qty` is used. Split one wanted quantity across providers if needed. If no complete assignment exists within budget, return null.

**Links.** Each pair of members that exchanges a non-cash item is one `Link` with its `flows`. Cash payer per link: if items flow one way only, the receiving intent pays. If items flow both ways, the payer is the intent whose Give contains a cash item, or none if neither does. Cash between non-counterparties is never created (D9).

**Ranking.** Fewer participants first, then better declared net for the viewer, then higher tiers. Exact and within-tolerance grades come later from negotiation (slice 06), so the engine only orders by structure.

**Key.** `arrangementKey` sorts `intentId@version` and joins with `|`. Two builds of the same participants at the same versions give the same key.

**findReplacement.** Given an arrangement and a vacated intent, find a candidate that can trade the same flows with every neighbor the vacated intent had, with identical items. The price check happens in negotiation. Return a new draft with the vacated slot replaced. A candidate who previously declined this key is excluded.

## Tests (Vitest, fixtures only)
1. **S1:** A, B, C produce one set of 3. B is in the middle. Links: A-B (A pays), B-C (B pays). No A-C link.
2. **Chain of 4:** A wants x1, B gives x1 wants x2, C gives x2 wants x3, D gives x3 wants cash. One set of 4, links in a line.
3. **Three-way swap:** A gives x wants y, B gives y wants z, C gives z wants x. One set of 3, no cash.
4. **S10:** user gives Fri and Sat, wants 3-day. Two buyers and a seller form a star of 4.
5. **Retraction:** remove D from the chain. C, B, A all drop out of the ready set.
6. **Unsatisfiable slot:** B wants x2 and nobody gives it. B and A are not in any set.
7. **Duplicates:** the same participants at the same versions give one key regardless of seed.
8. **Budget:** a dense fixture of 60 intents stops at the budget and returns `budgetExhausted: true`.
9. **Versions:** a signal built on an old version does not count.
10. **Quantity:** one seller with qty 4 and two buyers with qty 2 form one set.

## Notes
- Do not look at private bounds here. The engine reads public parts only.
- Do not choose prices here. Slice 06 does.
- Keep functions side-effect free so slice 05 can run them in a loop.