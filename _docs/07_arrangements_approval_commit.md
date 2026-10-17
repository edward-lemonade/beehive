# 07 Arrangements, Approval, and Commit

**Spec:** 6.6, 6.8, 6.9, 6.10, 6.11, 6.12, D2, D9, G12, G14, G15, G23. **Depends on:** 01, 04, 05, 06. **Feeds:** 08, 09.

Goal: the coordinator record. It turns closed sets into arrangements, runs pricing, freezes terms, collects approvals, repairs with replacements, and commits atomically. It is bookkeeping, not an agent.

## Components (`arrangements/`)
```
coordinator.ts   listens to signal.changed; creates candidates; drives the state machine
service.ts       create, price, propose, dissolve, revise
approvals.ts     request, record, void, timeout
replacement.ts   slot.vacated handling
commit.ts        the transaction
checklist.ts     builds per-participant hand-off checklist
routes.ts        approval endpoints for the web app
```

## State machine
```
candidate -> (pricing) -> proposed -> committed
     \-> dropped                \-> dissolved
```
- `candidate`: created from a closed set (slice 04). Never visible to users.
- `dropped`: pricing failed, a pre-check failed, or the key was previously declined.
- `proposed`: every link priced and frozen, pre-checks passed, approval requests out.
- `committed`, `dissolved`: terminal.

## Coordinator loop
On `signal.changed` (debounced 250 ms):
1. Load signals and edges. Call `findClosedSets` then `buildArrangement` (slice 04) for each new set.
2. Skip any key already known (open, committed, or declined by a participant).
3. Insert `candidate` with slots and links.
4. Call `priceArrangement` (slice 06). On `agreed`, freeze the amounts.
5. For each participant, build their `terms` view (below). Call `agent.precheck(terms)` for each. Any failure: `dropped`.
6. Move to `proposed`, create approval rows (respecting the pending cap of 3 per user, extras `queued`), emit `notify { kind: 'approval_request' }` per user.

## Terms view (what a user sees, G23)
Per participant: items they give and to whom (handle), items they get and from whom (handle), cash in and out per counterparty, difference from declared net, grade (`exact` or `within_tolerance`), and a count of **other participants they will not deal with** ("includes 1 other participant you will not deal with"). Never include non-counterparties' handles, items, or amounts. Build each view separately and assert that no foreign intent id appears in it.

Grade: `exact` if net matches declared net or better, `within_tolerance` if worse but at or above `minNetCents`. A worse-than-bound arrangement cannot reach this stage.

## Approvals
- States: `queued, requested, approved, declined, timed_out, retracted, void`.
- Approval covers the user's terms in a specific intent version. It stays valid across revisions where the terms are identical, or cash is better for the approver.
- Window: 24 simulated hours (`clock.after`). On timeout, treat as decline (state `timed_out`).
- Approve, decline, decline-and-withdraw, retract (until commit), and "negotiate further" are all service functions. SMS and web call the same ones.
- Declines write to `declined (user_id, arrangement_key)` so the same arrangement is never asked again.
- Reply codes (slice 08) map to `(user, arrangement, slot)` through `reply_codes`.

## Revision and replacement
Trigger `slot.vacated` for: decline, timeout, retraction, withdrawal, expiry, a version change that invalidates terms, or consumption by another commit.
1. Signals from the vacated intent are already retracted (slice 05).
2. Call `findReplacement` (slice 04) for the vacated slot among directly relevant Open intents of its former counterparties.
3. If a candidate exists: run pricing for the affected links starting from the **old amounts**. The replacement must accept those amounts, or better cash for the neighbors. Neighbors' terms must be identical or better.
4. If it prices: create revision N+1. Approvals whose terms are unchanged carry over. Only the new participant is asked. Neighbors are not messaged.
5. If not found within 24 simulated hours: `dissolved` with reason. Tell previously approved users once (`notify { kind: 'dissolved' }`).
6. A decliner never fills a replacement slot in the same arrangement.
7. If the vacated slot was a participant in the middle, other members cannot reassemble on their own, but their signals recompute and the coordinator may find a new set. Approvals carry to a new arrangement only where terms are identical.

On `intent.updated` for a participant: void that user's approval, revalidate the arrangement, and replace or dissolve.

## Commit (`commit.ts`)
One Postgres transaction:
1. `SELECT ... FOR UPDATE` on all participating intent rows, in id order (avoids deadlocks).
2. Check: every intent Open at the approved version; every approval valid; the arrangement is still `proposed` at the same revision; no intent consumed by another commit.
3. Set intents `done`, arrangement `committed`, approvals `fulfilled`.
4. Dissolve every other arrangement that contains any of those intents (reason `consumed`), and enqueue replacement attempts.
5. Build checklists and contact releases **per counterparty pair only** (A gets B, B gets A and C, C gets B). Read phone numbers from `users.phone` inside the transaction and write them to the outbound `notify` payloads.
6. After commit succeeds, publish `arrangement.committed` and notifications. Never send notifications inside the transaction.
If any check fails: roll back and send the arrangement back to collecting approvals or dissolve, depending on the failed check.

## Checklist (per participant)
Give: item, to whom (name and contact). Get: item, from whom. Cash out: amount, to whom. Cash in: amount, from whom. Suggested order: "complete the legs where you receive before the legs where you give" for participants with multiple links (G1). Steps can be marked done through the web app (no follow-up scheduling in v1).

## Routes
- `GET /arrangements/mine` returns the caller's terms views only.
- `POST /arrangements/:id/approve|decline|retract|negotiate-further`
- `POST /arrangements/:id/decline-withdraw`

## Acceptance
- S1 end to end with mocked SMS: A, B, C open in order, one arrangement is proposed, all approve, commit once. A's contacts include only B. B's include A and C. C's include only B.
- S2: C declines, D can fill C's slot at the same terms, a new revision forms, only D is asked, A and B approvals carry, commit succeeds.
- S3: no replacement within the window, arrangement dissolves, A and B are told once.
- S4: A is in two arrangements, one commits first, the other dissolves as `consumed`.
- Run 20 concurrent commit attempts on overlapping intents against a real Postgres: exactly one wins per intent, no deadlock.
- The terms view for A never includes C's handle or any C intent id.

## Notes
- Cut for the demo: freshness checks, revision caps, reliability penalties for late retraction.
- Keep one function `vacateSlot(arrangementId, intentId, reason)` as the entry for every repair path.