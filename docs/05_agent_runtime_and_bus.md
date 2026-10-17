# 05 Agent Runtime and Bus

**Spec:** 2 (principles 3, 8, 10), 6.3, 6.4, 6.5, D8, D11. **Depends on:** 01, 03, 04. **Feeds:** 06, 07, 10.

Goal: one lightweight agent object per Open intent, woken by events, talking only through a guarded in-process bus. This is the layer that enforces the no-gossip rule.

## Components (`runtime/`)
```
bus.ts         send(envelope), subscribe(intentId, handler); in-memory queue with per-recipient ordering
guard.ts       checks every outgoing envelope (below)
agent.ts       class Agent { intentId, wake(reason), onMessage(env), precheck(terms) }
scheduler.ts   wake queue, coalescing, per-intent serialization, search budget
registry.ts    Map<IntentId, Agent>; create/destroy on intent.opened/closed
rehydrate.ts   on boot: load Open intents, rebuild agents, recompute and re-emit signals
```

## Agent behavior
`wake(reason)`:
1. Load own intent (public + private) and `getEdges(intentId)` from slice 03.
2. Load signals addressed to self from the `signals` table.
3. Call `localStatus` (slice 04). Compare with the last status sent to each relevant neighbor.
4. For each neighbor whose status changed, send a `signal` envelope to that neighbor only. Persist to `signals`.
5. Emit `signal.changed` so the coordinator (slice 07) can look for closed sets.
6. If there are no relevant neighbors or no covers, and the intent has no pending arrangement, compute near misses (slice 03) and emit `notify { kind: 'nothing_found' }` once per intent version. Set the in-memory `dormant` flag. Any later wake clears it.

`onMessage(env)`:
- `signal`: upsert into `signals`, then `wake('signal')`.
- `offer`, `accept`, `walk`, `say`: forward to the negotiation session (slice 06).

`precheck(terms)`: deterministic checks against the owner's private part and public part: net cash meets `minNetCents`, items and quantities match, radius and deadline hold, intent still at the same version and Open. Returns `{ ok, reason }`. The coordinator calls it when proposing.

## Guard (`guard.ts`)
Every envelope passes through `guard(env)` before delivery. Reject (and report, slice 10) when any of these hold:
1. **Addressee check:** `env.to` is not in the sender's current relevant edges. Coordinator envelopes skip this check but must be addressed to a slot in the named arrangement.
2. **Schema check:** body does not parse as one of the allowed `BusBody` types (strict, no extra keys).
3. **Content check:** `say.text` or any string in the body contains a number equal to the sender's `minNetCents`, `-minNetCents`, or any bound value (as digits, with `$`, or with commas), or contains another intent's id or handle that is not the recipient.
4. **Version check:** `signal` versions do not match current versions.
A rejected envelope is dropped, not sent. The guard returns a typed violation `{ rule, from, to }`.

Do not sanitize and send. Drop and report.

## Scheduler
- Wake sources: `edges.changed`, `signal.changed` addressed to the intent, `intent.updated` for the owner, the periodic check from slice 03, and a manual "keep looking".
- Coalesce: multiple wakes for one intent within 250 ms real time run once.
- Serialize per intent: never run two wakes for the same agent at once. Different agents run concurrently.
- Search budget: `SEARCH_BUDGET_EXPANSIONS` and `SEARCH_BUDGET_MS` from config are passed to slice 04 calls. Count every budget exhaustion.
- Use `setImmediate`-style yielding so a large wake burst does not block HTTP.

## Rehydration
On boot:
1. Load all Open intents, create agents.
2. Wipe in-memory negotiation sessions. For any link that was mid-negotiation, mark the link `unpriced` and let slice 07 restart it.
3. For each agent, `wake('boot')`. Signals are recomputed from edges, and unchanged ones are not re-sent.
Result: a Render restart is invisible apart from a short delay.

## Retraction
When an intent leaves Open (withdrawn, expired, done) or changes version, its agent sends `signal` with `satisfiable: false` to every neighbor it had signaled, then is destroyed. Receivers recompute on wake. This is also how replacement starts (slice 07).

## Acceptance
- Seeded S1: after C opens, B's agent sends signals to A and C, A's and C's agents send signals to B, and no message is ever addressed A-to-C. Check the bus log.
- Removing C causes B to retract toward A, and A's status goes false.
- Guard unit tests: a message to a non-relevant intent is dropped; a `say` containing the sender's bound number is dropped; an extra key in a body is dropped.
- Kill and restart the process with the S1 seed in place. After boot, statuses and signals match the pre-restart state with no duplicate arrangements.
- 200 intents seeded: a single wake burst settles in under 3 seconds real time.

## Notes
- Coordinator envelopes carry only the recipient's own terms. Build the terms object per recipient. Do not reuse a shared object.
- Add a trace header slot to every envelope (`trace.sentryTrace`, `trace.baggage`). Slice 10 fills and reads it.
- Log every bus message to the `negotiation_log` or a `bus_log` table in dev for debugging. Disable the content copy in production.