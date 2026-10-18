# Slice 09 TODOs: Public Intent Feed and Panels

## Goal
A plain, phone-width React UI: sign in with Clerk, browse public intents, compose and confirm drafts, manage own intents, approve arrangements and follow agent activity. No map and no locations.

Spec: `_docs/09_map_ui.md`. Depends on Slices 01, 02, 07 (done). Slice 08 (SMS) is skipped, so `onboarding/PhoneLink.tsx` and `POST /me/link-code` are out of scope here.

## Decisions to confirm before coding
- [x] Package name: the repo uses `@clerk/react` (not `@clerk/clerk-react`). Keep it.
- [x] Add `@tanstack/react-query`, `react-router-dom` and Tailwind (`tailwindcss` plus `@tailwindcss/vite`). Recommended; or skip the router and use a single page with tabs.
- [x] Add `VITE_API_URL` (default `http://localhost:3000`) to `frontend/.env.example`. Needs your value only if the backend is not on the default port.
- [x] Backend CORS must allow the frontend origin and the `Authorization` header. Check `backend/src/index.ts`, and add it if missing.
- [x] `/stream` auth: `EventSource` cannot send headers. Confirm how the backend authenticates it (token query param or fetch-based SSE). Use a fetch-stream reader if headers are required.
- [x] Missing backend routes in the spec: `GET /map/intents` exists as the public feed, but the stream payload shape for `negotiation.round` and arrangement events must be checked against `src/index.ts`.
- [x] Mocked data mode (`VITE_MOCK=1`) for the 30-card acceptance check. Recommended.

## Workstream 1: setup
- [x] Install dependencies; wire Tailwind into `vite.config.ts` and `index.css`.
- [x] `QueryClientProvider` and router in `main.tsx`; keep the existing `ClerkProvider`.
- [x] Signed-out view with Clerk sign-in; signed-in layout with a header and `UserButton`.
- [x] Mobile-first layout: single column on phones, feed beside panels on wide screens.
- [x] Confirm `src/contracts` is in sync (`bash scripts/sync-contracts.sh`).

## Workstream 2: API client and stream
- [x] `api/client.ts`: fetch wrapper that adds the Clerk token (`useAuth().getToken`), parses `{ok, ...}` responses, throws typed errors; responses validated with the contracts schemas where they exist.
- [x] Query hooks: public intents, my intents, arrangements, near-misses, relevant.
- [x] `api/stream.ts`: SSE subscription to `GET /stream` with auto-reconnect and backoff.
- [x] Stream events invalidate the matching queries; polling every 10 s when the stream is down.
- [x] Mock layer returning contract-shaped JSON for 30 public intents, own intents and arrangements.

## Workstream 3: public feed
- [x] `feed/PublicIntents.tsx`: card per open intent with truncated free text, handle and tier badge; click expands.
- [x] Expanded card shows a "user-written" label.
- [x] Own intents highlighted.
- [x] Cards appear, change and disappear live with stream events.
- [x] Free text rendered as plain text only; no `dangerouslySetInnerHTML` anywhere (add a lint or grep check).

## Workstream 4: composer and my intents
- [x] `panels/Composer.tsx`: free text, `POST /intents/draft`, shows the parsed draft and any question, `POST /intents/draft/:id/answer`, confirm via `POST /intents/draft/:id/confirm`. No location fields.
- [x] `panels/MyIntents.tsx`: own intents with state, edit (`PATCH /intents/:id`), withdraw, reopen.
- [x] Near-misses and "keep looking" shown for dormant intents (`GET /intents/:id/near-misses`, `POST /intents/:id/keep-looking`).
- [x] Inline error and loading states for each action.

## Workstream 5: message their agent
- [x] On card expand, call `GET /intents/:id/relevant`.
- [x] Relevant: show "Message their agent" button; dialog with optional target price calling `POST /negotiate`.
- [x] Not relevant: muted "Not a possible trade for your intents" and no button.
- [x] Progress appears in the agent feed.

## Workstream 6: approvals
- [x] `panels/Approvals.tsx` from `GET /arrangements/mine`: give and get lines, cash, difference, grade, "includes N other participants you will not deal with" and the response deadline (live countdown).
- [x] Buttons: Approve, Decline, Decline and withdraw, Negotiate further (target price input); retract after approving.
- [x] After commit: counterparty contacts and checklist with tick boxes (`POST /arrangements/:id/checklist/:stepId/{done|undone}`).
- [x] Buttons disabled while a request is in flight; 409 and 404 handled with a refresh and a message.

## Workstream 7: agent feed
- [x] `panels/AgentFeed.tsx` from the stream: `negotiation.round` ("Offered $55", "Accepted at $50") with `say` text as speech lines.
- [x] State changes: signal sent, arrangement proposed, replacement found, dissolved, committed.
- [x] Capped, newest-first list with timestamps.

## Workstream 8: tests and verification
- [x] Unit tests (vitest plus Testing Library) for: card renders `<img src=x onerror=alert(1)>` as visible text, no message button for non-relevant intents, 30 mocked cards render without console errors, approvals card privacy wording.
- [x] `npm run lint`, `npm run build` clean in `frontend/`.
- [x] Browser check at phone width against mocked data.
- [ ] Manual check with the real API: confirm a draft and see the card on a second browser within 2 seconds.
- [ ] Approve in the panel and see state and checklist update from stream events.
- [x] Add implementation notes to this file.

## Out of scope
- Map, locations and location-based discovery.
- Phone linking, the Photon number and SMS parity (Slice 08).
- Sentry browser SDK (Slice 10).

## Implementation notes
- No router: a single page with tabs on phones and a three-column grid on wide screens.
- Backend changes this slice needed: `/stream` was a stub using `x-user-id` with nothing publishing to it. It now requires auth, streams the user channel plus a public channel, sends heartbeats and cleans up on disconnect. `sse/bridge.ts` forwards `intent.*`, `notify`, `arrangement.*`, `slot.vacated` and `negotiation.round` (resolved to both owners). `negotiation.round` now carries kind, amount and text.
- `src/index.ts` now actually serves (`PORT`, default 3000) and enables CORS (`FRONTEND_ORIGIN`, default any). Both are optional env vars.
- The stream is fetch-based (not `EventSource`) so the Clerk bearer token can be sent. It reconnects with backoff, and queries poll every 10 s while it is down.
- The agent feed has no "signal sent" line because no user-facing event exists for it yet.
- `VITE_MOCK=1` runs the UI on mock data without Clerk. Checked at 390px width: 30 cards, no console errors, no overflow.
- Tests: frontend 8 (vitest), backend `stream.test.ts` 3. Backend total 118 passing. Lint and builds clean.
- Still unchecked: the two manual real-API checks (they need Clerk keys and two browsers).
