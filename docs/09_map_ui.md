# 09 Map UI

**Spec:** 6.17, 6.18, 6.9, G7. **Depends on:** 01 (contracts copy), 02 (routes). Can start with mocked data. **Host:** Vercel.

Goal: a map where every Open intent is a bubble, plus panels for the user's own intents, approvals, and a live feed of what their agent is doing. Sign-in with Clerk.

## Stack
The `frontend/` folder already has Vite, React, TypeScript, and Clerk (`@clerk/clerk-react`) set up. Add the rest to it: `react-leaflet` with OpenStreetMap tiles (no API key), TanStack Query for fetches, Tailwind for styling. Import types from `src/contracts` (a copy of the backend's, see slice 01).

**Why Leaflet and not Mapbox or Google.** No key, no billing setup, and custom HTML markers are easy. Swap later if needed.

## Screens and components
```
src/
  main.tsx, App.tsx          Clerk provider (already set up; extend it), router
  api/client.ts              fetch wrapper that adds the Clerk token; typed with the contracts copy
  api/stream.ts              SSE subscription with auto-reconnect
  map/MapView.tsx            Leaflet map centered on CAMPUS_CENTER
  map/Bubble.tsx             chat-bubble marker (DivIcon + React portal)
  map/LocationFreeStrip.tsx  list for intents with no point
  panels/Composer.tsx        free-text box + "drop pin" mode
  panels/MyIntents.tsx       own intents, state, edit, withdraw
  panels/Approvals.tsx       pending arrangements as terms cards
  panels/AgentFeed.tsx       live negotiation and signal activity for my intents
  panels/MessageAgent.tsx    dialog for the manual "message their agent"
  onboarding/PhoneLink.tsx   shows the Photon number and the 4-digit code
```

## Behavior
**Bubbles**
- One bubble per Open intent at its coarse point. The bubble shows the free text (truncated, expands on click), the handle, and the tier badge.
- Render free text as plain text only. React escapes by default. Never use `dangerouslySetInnerHTML` anywhere in this app. Add a small "user-written" label on expanded bubbles (G7).
- Highlight the user's own bubbles.
- Cluster nearby bubbles (use `react-leaflet-cluster` or a simple grid). Overlapping text bubbles are unreadable otherwise.
- Intents that are location-free appear in the side strip.

**Composer**
- Free text input. "Drop pin" toggles a mode where the next map click sets the location. The pin is sent with `POST /intents/draft`.
- Shows the agent's parsed draft and any question in the panel. Confirm or edit from there. This is the same draft flow as SMS.

**Message their agent**
- Clicking a bubble shows a "Message their agent" button only when `GET /intents/:id/relevant` says the bubble is directly relevant to one of your intents (route added in slice 07 or 03; it returns just a boolean and the matching own intent id).
- If not relevant, show a muted note "Not a possible trade for your intents" and no button.
- The dialog lets the user optionally set a target price, then calls `POST /negotiate` with the bubble's intent id. Progress shows in the feed.

**Approvals panel**
- Renders the `terms` view from `GET /arrangements/mine`: give/get lines, cash, difference, grade, "includes N other participants you will not deal with," and the response deadline.
- Buttons: Approve, Decline, Decline and withdraw, Negotiate further.
- After commit, shows the counterparty contacts and the checklist with tick boxes.

**Agent feed**
- Subscribes to `GET /stream`. Shows `negotiation.round` events for the user's own intents ("Offered $55", "Accepted at $50"). This is the best demo visual because it shows agents working while the map stays still. Show `say` text as speech lines.
- Shows state changes: signal sent, arrangement proposed, replacement found.

**Live updates**
- Public channel: bubbles appear, change, and disappear as intents open, update, or close.
- User channel: approvals, feed events, status changes.
- Fall back to polling every 10 s if the stream drops.

## Routes used
`GET /map/intents`, `POST /intents/draft`, `POST /intents/draft/:id/answer`, `POST /intents/draft/:id/confirm`, `GET /intents/mine`, `PATCH /intents/:id`, `POST /intents/:id/withdraw`, `GET /arrangements/mine`, `POST /arrangements/:id/*`, `GET /intents/:id/near-misses`, `GET /intents/:id/relevant`, `POST /negotiate`, `POST /me/link-code`, `GET /stream`.

## Acceptance
- Loads with mocked JSON matching the contracts and renders 30 bubbles with no console errors.
- A bubble whose free text contains `<img src=x onerror=alert(1)>` renders as visible text and runs nothing.
- Clicking a non-relevant bubble shows no message button.
- With the real API, confirming a draft makes a bubble appear within 2 seconds on a second browser.
- Approving in the panel and approving by SMS reach the same state. Both views update.
- Works at phone width (the demo may be shown on a phone).

## Notes
- No exact coordinates are ever available client-side for other users. Rely on the coarse point from the API.
- Keep the UI plain. The map and the feed carry the demo, so skip animations beyond bubble pop-in.
- Add the Sentry browser SDK in slice 10.