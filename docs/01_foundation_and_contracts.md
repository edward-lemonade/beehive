# 01 Foundation and Contracts

**Spec:** 4 (terminology), 6.6, 8 (parameters). **Depends on:** nothing. **Everything depends on this.**

Goal: a backend that builds, a database that migrates, authenticated requests, a Clock, an SSE hub, and the Zod contracts every other slice imports (the frontend gets a copy). Merge this first.

## Tasks
1. `backend/` as its own npm project (no workspace). TypeScript strict, Vitest, ESLint. The existing `frontend/` is left as is, except for step 9.
2. `backend/src/config.ts`: parse env with Zod, export typed `config`. Fail fast on missing vars.
3. `backend/src/clock.ts`: `clock.now()`, `clock.after(simMs, fn)`, `clock.cancel(id)`. Real time = simulated time / `TIME_SCALE`. All durations in `contracts/constants.ts` are simulated ms.
4. Drizzle schema and migrations (tables below). Connect with Supabase's pooled connection string.
5. Clerk: `requireAuth` Hono middleware that verifies the Bearer token and loads `ctx.user`. First sight of a Clerk id creates a `users` row with a generated handle (for example `Otter-42`) and tier `new`.
6. `sse/hub.ts`: `publish(channel, event)` and `GET /stream` (auth required). Channels: `user:<id>` and `public:map`.
7. Typed internal event emitter (`events.ts`) using the names below.
8. `GET /health`. Error handler that returns JSON.
9. Copy `backend/src/contracts/` to `frontend/src/contracts/`. Add a `scripts/sync-contracts.sh` at the repo root that does the copy, so it is one command to re-run.

## Contracts (`backend/src/contracts`)
```ts
Item         { kind: 'ticket'|'sublet'|'cash'|'other', label: string, attrs: Record<string,string|number>,
               qty: number, amountCents?: number, flex?: 'firm'|'flexible' }   // amount/flex only for cash
WantItem     { anyOf: Item[] }
IntentPublic { intentId, version, ownerHandle, tier, give: Item[], want: WantItem[],
               location: {lat,lng}|null, radiusKm: number, deadline: string|null, freeText: string }
IntentPrivate{ minNetCents: number|null, declaredNetCents: number|null }
IntentState  'draft'|'open'|'done'|'withdrawn'|'expired'
```
- `label` is a normalized slug the parser produces (for example `coachella-2027-fri-ga`). Item match compares `kind` and `label`, then `attrs`.
- Cash is an Item of kind `cash`. At most one cash item per side.
- `minNetCents` is the private bound as a net: a buyer capped at $320 has `-32000`, a seller who needs $280 has `28000`, a middle participant who must not lose money has `0`. `declaredNetCents` is the same figure from the stated terms, used for opening offers.

```ts
EdgeCover    { slot: string, provider: IntentId, item: Item }   // who can cover one of my slots
Signal       { from, to, fromVersion, toVersion, satisfiable: boolean }
Flow         { from: IntentId, to: IntentId, item: Item }       // non-cash
Link         { id, a: IntentId, b: IntentId, flows: Flow[], payer: IntentId|null,
               amountCents: number|null, state: 'unpriced'|'agreed'|'failed' }
Slot         { intentId, intentVersion, approval: ApprovalState }
ApprovalState 'queued'|'requested'|'approved'|'declined'|'timed_out'|'retracted'|'void'
Arrangement  { id, key, state: 'candidate'|'dropped'|'proposed'|'committed'|'dissolved', revision,
               slots: Slot[], links: Link[] }
```
`key` = sorted `intentId@version` joined. It is the arrangement's identity (G12).

### Bus body types (the only allowed agent-to-agent messages)
```ts
BusBody =
 | { type:'signal', fromVersion, toVersion, satisfiable }
 | { type:'offer',  linkId, round, amountCents }
 | { type:'accept', linkId, amountCents }
 | { type:'walk',   linkId }
 | { type:'say',    linkId, text }          // display only, never read by the receiver's logic
Envelope = { id, from: IntentId|'coordinator', to: IntentId, sentAt, trace: { sentryTrace, baggage }, body: BusBody }
```

### Events (`events.ts`)
`intent.opened|updated|closed`, `edges.changed`, `signal.changed`, `arrangement.candidate|priced|proposed|committed|dissolved`, `slot.vacated`, `negotiation.round`, `notify` `{ userId, kind, payload }`.

## Tables (Drizzle)
- `users` id, clerk_id, handle, tier, phone, phone_verified, created_at
- `intents` id, user_id, version, state, public jsonb, private jsonb, lat, lng, radius_km, deadline, created_at, updated_at
- `intent_versions` intent_id, version, public jsonb, private jsonb
- `notices` observer_intent, intent, version, relevant bool, covers jsonb, PK (observer_intent, intent, version)
- `signals` from_intent, to_intent, from_version, to_version, satisfiable, updated_at, PK (from_intent, to_intent)
- `arrangements` id, key, state, revision, created_at, dissolved_reason
- `arrangement_slots` arrangement_id, intent_id, intent_version, approval, approved_at, terms jsonb
- `links` id, arrangement_id, a_intent, b_intent, flows jsonb, payer, amount_cents, state
- `declined` user_id, arrangement_key (for G12 "not previously declined")
- `negotiation_log` link_id, round, from_intent, kind, amount_cents, text, created_at
- `sms_log` id, user_id, direction, body, provider_id, created_at (unique provider_id for dedupe)
- `reply_codes` code, user_id, arrangement_id, kind, expires_at

Indexes: `intents (state)`, `intents (lat, lng)`, `signals (to_intent)`, `arrangement_slots (intent_id)`.

## Acceptance
- `npm run build` and `npm test` pass in `backend/` from a clean checkout, and `npm run build` passes in `frontend/`.
- A request with a valid Clerk token creates a user once and returns the same handle on repeat.
- `TIME_SCALE=60` makes `clock.after(60000, fn)` fire in about 1 second.
- `frontend/src/contracts` matches `backend/src/contracts` (the sync script produces no diff), and the web app can import `IntentPublic` from it.

## Notes
- Do not store contact details outside `users.phone`. The coordinator reads it only at commit (slice 07).
- Keep Zod schemas as the single source in `backend/`. Derive TS types with `z.infer`. Do not edit the frontend copy by hand.