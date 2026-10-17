# 00 Overview: Architecture, Stack, and Slice Map

Read this first. Every slice doc assumes it. The behavior spec is `intent-exchange-spec.md`; slice docs cite it as "Spec 6.x" or "Gn".

## What we are building
Users post free-text intents. Agents (one per intent) find closed sets of directly relevant intents, negotiate per-link prices within private bounds, and ask each user to approve over SMS. A map shows every Open intent as a bubble. Sentry traces every agent wake-up and watches the privacy invariants.

## Stack

| Layer | Choice | Host |
|---|---|---|
| Backend | Node.js + TypeScript, Hono | Render (one web service) |
| DB | Postgres via Drizzle ORM | Supabase |
| Frontend | Vite + React + TypeScript, react-leaflet | Vercel |
| Auth | Clerk (JWT verified in API) | Clerk |
| LLM | Vercel AI SDK (`ai`) with Anthropic provider, Zod structured output | API |
| Messaging | Photon Spectrum (`spectrum-ts`) | Render (same service) |
| Monitoring | Sentry (`@sentry/node`, `@sentry/react`) | Sentry |

**Why Node instead of FastAPI.** Spectrum is a Node/Bun SDK, so Python would need a second service just for messaging. The domain is also type-heavy (items, flows, arrangements, bus messages), and one language lets the frontend reuse the backend's Zod schemas (copied, not packaged). Sentry's AI integration also covers the Vercel AI SDK directly.

**Agent hosting.** Agents are not separate processes. Each is a lightweight object inside the one API process, woken by events. This makes the in-process bus, trace propagation, and invariant checks simple. State lives in Postgres and is rebuilt on boot (slice 05), so a Render restart loses nothing. Keep exactly one instance, since the bus is in memory. Details in slice 11.

## Repo layout
```
backend/src/
  contracts/       zod schemas, event names, constants        (01)
  config.ts clock.ts db/ auth/ sse/                           (01)
  intents/                                                    (02)
  discovery/                                                  (03)
  engine/                                                     (04)
  runtime/                                                    (05)
  negotiation/                                                (06)
  arrangements/                                               (07)
  messaging/                                                  (08)
  observability/                                              (10)
  seed/                                                       (11)
frontend/src/                                                 (09)
  contracts/       copy of backend/src/contracts              (01)
```
Two independent folders, each with its own `package.json` and `npm install`. No workspaces and no shared package. `frontend/` already exists (Vite + React + Clerk), so build into it rather than re-scaffolding.

**Contracts are duplicated.** `backend/src/contracts/` is the source of truth. When it changes, copy the files into `frontend/src/contracts/` in the same commit. The frontend copy keeps only the types and Zod schemas it uses. Never import across the two folders.

## Slices and dependencies

| # | Slice | Depends on |
|---|---|---|
| 01 | Foundation and contracts | none |
| 02 | Intents and parsing | 01 |
| 03 | Discovery and relevance | 01, 02 |
| 04 | Engine (pure signal and formation logic) | 01 |
| 05 | Agent runtime and bus | 01, 03, 04 |
| 06 | Negotiation | 01, 05 |
| 07 | Arrangements, approval, commit | 01, 04, 05, 06 |
| 08 | Messaging (Photon) | 01, 02, 07 |
| 09 | Map UI | 01, 02 (API contracts only) |
| 10 | Observability (Sentry) | 01, hooks in 02, 05, 06 |
| 11 | Seed, deploy, demo | all |

Parallel lanes once 01 is merged:
- **Lane A:** 02, then 03
- **Lane B:** 04 (pure, no DB), then 05, 06
- **Lane C:** 09 (against a mocked API using the copied contracts)
- **Lane D:** 08 (against the terminal adapter), 10

## Runtime flow
1. User confirms an intent (02). `intent.opened` fires.
2. Discovery (03) updates notices and relevance edges for that intent and its neighbors.
3. Each affected agent (05) recomputes its status (04) and sends signals to relevant neighbors only.
4. The coordinator (07) watches the signal table. When a closed set exists, it creates an arrangement (04 builds the flows).
5. Negotiation (06) prices each trade link. Agents check bounds in code.
6. The coordinator freezes amounts and sends proposals. Agents pre-check (05).
7. Users are asked to approve over SMS (08) or in the app (09).
8. When all approvals are valid, commit (07). Contacts go only to counterparties.
9. A decline, timeout, or withdrawal retracts signals, and the coordinator looks for a replacement with identical terms for everyone else.

## Rules every slice must follow
1. **No gossip.** Agent-to-agent messages go only through the bus (05), only to directly relevant intents, and only carry the allowed body types (01). The guard enforces this.
2. **Bounds live in code.** An LLM never decides a price, a status, or an approval. It parses text and words messages.
3. **Free text is display-only.** It is never put in another agent's prompt or used in matching.
4. **Private part never leaves the owner's agent.** No API route returns it except to the owner.
5. **All durations go through the Clock** (01) so demo speed is one env var.
6. **Agent state is rebuildable from Postgres.**
7. **Code style:** TypeScript strict, Zod at every boundary, sparse comments, no refactors beyond the task.

## Env vars
`DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, `LLM_MODEL_FAST`, `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `PHOTON_WEBHOOK_SECRET`, `CHANNEL` (`photon` or `terminal`), `SENTRY_DSN_API`, `TIME_SCALE`, `SEARCH_BUDGET_EXPANSIONS` (200), `SEARCH_BUDGET_MS` (5000), `NEGOTIATION_ROUNDS` (3), `DEFAULT_RADIUS_KM` (4.8), `COARSE_GRID_M` (500), `CAMPUS_CENTER_LAT`, `CAMPUS_CENTER_LNG`.
Web: `VITE_API_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_SENTRY_DSN`.

## Not building
Dormancy states beyond one "nothing found" notice, approval freshness, reliability scoring (tiers are a seeded field), follow-ups, revision caps, sublet deposits, image proof, quiet hours.

## Things to verify early
- **Photon and SMS.** Photon's main product is iMessage lines, with SMS/RCS fallback. Confirm the line sends real SMS to non-iMessage numbers, since the challenge says SMS.
- **Photon users.** A Photon project can only message people it knows. Read the API reference for registering users, and pre-register the team's phones.
- **Photon docs version.** Stable and Beta docs differ (project ids starting `pho_prj_` are Beta). Pick one and stay on it.
- **Sentry metrics API.** Check the installed `@sentry/node` version exposes `Sentry.metrics`.