# 06 Negotiation

**Spec:** 6.7, D2, D9, G4, G24, principle 3. **Depends on:** 01, 05. **Feeds:** 07.

Goal: price every trade link of a candidate arrangement. Each link is bargained by the two agents that share it, only within their private bounds. The LLM writes wording only. Every number comes from code.

## Module API (`negotiation/`)
```ts
priceArrangement(arrangementId): Promise<'agreed'|'failed'>
runLinkSession(link: Link, payer: Agent, receiver: Agent, bounds: LinkBounds): Promise<LinkResult>
nextOffer(state: SessionState, side: 'payer'|'receiver'): number        // pure
withinBounds(side, amountCents, bounds): boolean                        // pure
deriveLinkBounds(participant, allLinks, pricedSoFar): { minCents, maxCents }   // pure
wording(offerContext): Promise<string>                                  // LLM, display only
```
`LinkResult = { state: 'agreed'|'failed', amountCents?: number, rounds: number }`.

## Money model
- Each participant has a net-cash constraint: `receipts - payments >= minNetCents` (slice 01). Buyers have a negative minimum, sellers a positive one, middle participants usually 0.
- Direction comes from the link: `link.payer` pays `link.amountCents` to the other side (slice 04).
- A link has one amount. Both sides must accept the same number.

## Pricing order and bounds (the coupled-link problem)
A participant in the middle (B in S1) has two links, and its limits on one depend on the other.
1. Order links by constraint: price links where a participant has **no other unpriced link** first. For S1 either end link works; pick the lower link id for determinism.
2. For a participant with several links, `deriveLinkBounds` assumes every other unpriced link settles at the best case for that participant (the other side's public declared amount, if any). From that it computes the range this link may take while keeping `net >= minNetCents`.
3. After a link is agreed, recompute bounds for the participant's remaining links using the real amount.
4. If a later link cannot fit its participant's constraint, the whole arrangement fails. Discard agreed amounts, since nothing was frozen.
5. If public declared amounts are missing on the other side, use the participant's own `declaredNetCents` as the opening anchor and `minNetCents` as the hard bound.

Example (S1): C asks at least $50, A will pay at most $60, B needs net >= 0. Price B-C first: B's best-case receipt from A is A's declared $60, so B may pay C up to $60. Opening offers meet at $50. Then A-B: B must receive at least $50 (what it pays C plus its minimum net), A pays at most $60, so the range is $50 to $60.

## Session protocol (over the bus)
Rounds are capped by `NEGOTIATION_ROUNDS` (3).
1. Payer opens low: first offer at its declared amount, or the low end of its range if none.
2. Receiver compares. If the offer meets its minimum, it replies `accept`. Otherwise it sends a counter `offer` conceding one step toward its bound.
3. Each side concedes linearly: `step = (bound - opening) / NEGOTIATION_ROUNDS`.
4. If offers cross or equal, the later side's `accept` fixes the amount at the **receiver's ask** when both fall within bounds (G4 default).
5. After the round limit, if ranges overlap, fall back to the receiver's declared ask when the payer's bound allows it. If the receiver declared no ask, use the amount that leaves the receiver at its `minNetCents`. If ranges do not overlap, send `walk`. The link fails.
6. A `flex: 'firm'` cash amount never moves. Firm amounts are the only value tried.

## Hard rules
- `withinBounds` runs on every outgoing offer and accept, in code, before the envelope reaches the guard. An out-of-bounds amount is a bug: throw, and let slice 10 capture it.
- `wording()` receives only: round number, the amount being offered, and a tone hint. It never receives the sender's bounds or the other side's private data. Its output goes into the `say` body only. The receiver's logic ignores `say` entirely.
- No LLM output is parsed for numbers or decisions.
- Messages never contain third-party handles.

## Wording
One short sentence per round, for example "Could you do $55?" or "That works for me." Use `LLM_MODEL_FAST`, `functionId: 'negotiation.wording'`, and a 5 second timeout. On timeout or error, fall back to a template string so the negotiation never stalls.

## Persistence and events
- Write each round to `negotiation_log` with the sender, kind, amount, and text.
- Emit `negotiation.round` per round (the web activity feed in slice 09 subscribes).
- On link `agreed`, update `links.amount_cents`. When every link is agreed, emit `arrangement.priced`.
- On `failed`, the coordinator marks the arrangement `dropped` and stores `declined`-style memory so the same key is not re-proposed until a version changes.

## User-triggered negotiation
- "Negotiate further" and the map's "Message their agent" (slice 09) call `runLinkSession` with the user's new target as the opening anchor. The target must still pass `withinBounds`, or the agent tells the user it needs a bound change (an SMS asking to confirm, slice 08).
- Any change after approval requests have gone out creates a new revision (slice 07).
- Route: `POST /negotiate` `{ ownIntentId, targetIntentId, targetCents? }`. It rejects with 403 unless the target is directly relevant to the caller's intent (same check as `GET /intents/:id/relevant`). It then runs a session for the shared link only. A successful result is a priced link. It still needs a closed set, so the coordinator (slice 07) creates the arrangement only if one exists. Otherwise the agent reports the agreed price to the user and keeps listening.

## Acceptance
- S1: A max $60, C min $50, B min net 0. Result: B-C at $50, A-B between $50 and $60, all agreed within 3 rounds.
- A firm seller at $315 and a buyer capped at $300 end in `failed`, and a near miss is reported (slice 03).
- A mocked LLM that returns "my minimum is 28000" in `wording` causes the guard to drop the envelope. The negotiation continues with the template fallback.
- Property test: for 500 random bound pairs, an agreed amount is always within both bounds.
- Pricing S1 produces the same amounts on repeated runs (determinism, with the LLM mocked).

## Notes
- Skip revision caps and multi-pass bargaining. One pass per link is enough.
- Keep the session state in memory only. Rehydration (slice 05) restarts pricing for unfinished arrangements.