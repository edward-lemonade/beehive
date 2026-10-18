# 09 Public Intent Feed

**Spec:** 6.17, 6.18, 6.9, G7. **Depends on:** 01 (contracts copy), 02 (routes). Can start with mocked data. **Host:** Vercel.

> **Superseded in part:** the panel layout below was redesigned as a chat with the user's agent. See [12_agent_chat_ui.md](12_agent_chat_ui.md). The feed, intent list, API client and stream described here still apply.

Location and map-based browsing are deferred. Until location is added back to the intent model, this slice provides a public intent feed and panels for the user's own intents, approvals, and agent activity. Sign-in with Clerk.

## Stack
The `frontend/` folder already has Vite, React, TypeScript, and Clerk (`@clerk/clerk-react`) set up. Add TanStack Query for fetches and Tailwind for styling. Import types from `src/contracts` (a copy of the backend's, see slice 01). Do not add a map SDK until locations are part of intents again.

## Screens and components
```
src/
  main.tsx, App.tsx          Clerk provider (already set up; extend it), router
  api/client.ts              fetch wrapper that adds the Clerk token; typed with the contracts copy
  api/stream.ts              SSE subscription with auto-reconnect
  feed/PublicIntents.tsx     list of Open public intents
  panels/Composer.tsx        free-text box
  panels/MyIntents.tsx       own intents, state, edit, withdraw
  panels/Approvals.tsx       pending arrangements as terms cards
  panels/AgentFeed.tsx       live negotiation and signal activity for my intents
  panels/MessageAgent.tsx    dialog for the manual "message their agent"
  onboarding/PhoneLink.tsx   shows the Photon number and the 4-digit code
```

## Behavior
**Public intents**
- One card per Open intent. Show its free text (truncated, expands on click), handle, and tier badge.
- Render free text as plain text only. React escapes by default. Never use `dangerouslySetInnerHTML` anywhere in this app. Add a small "user-written" label on expanded cards (G7).
- Highlight the user's own intents.
**Composer**
- Free text input. Locations are not collected or sent.
- Shows the agent's parsed draft and any question in the panel. Confirm or edit from there. This is the same draft flow as SMS.

**Message their agent**
- Clicking an intent card shows a "Message their agent" button only when `GET /intents/:id/relevant` says the intent is directly relevant to one of your intents (route added in slice 07 or 03; it returns just a boolean and the matching own intent id).
- If not relevant, show a muted note "Not a possible trade for your intents" and no button.
- The dialog lets the user optionally set a target price, then calls `POST /negotiate` with the bubble's intent id. Progress shows in the feed.

**Approvals panel**
- Renders the `terms` view from `GET /arrangements/mine`: give/get lines, cash, difference, grade, "includes N other participants you will not deal with," and the response deadline.
- Buttons: Approve, Decline, Decline and withdraw, Negotiate further.
- After commit, shows the counterparty contacts; the deal then moves off platform.

**Agent feed**
- Subscribes to `GET /stream`. Shows `negotiation.round` events for the user's own intents ("Offered $55", "Accepted at $50"). Show `say` text as speech lines.
- Shows state changes: signal sent, arrangement proposed, replacement found.

**Live updates**
- Public channel: intent cards appear, change, and disappear as intents open, update, or close.
- User channel: approvals, feed events, status changes.
- Fall back to polling every 10 s if the stream drops.

## Routes used
`GET /map/intents`, `POST /intents/draft`, `POST /intents/draft/:id/answer`, `POST /intents/draft/:id/confirm`, `GET /intents/mine`, `PATCH /intents/:id`, `POST /intents/:id/withdraw`, `GET /arrangements/mine`, `POST /arrangements/:id/*`, `GET /intents/:id/near-misses`, `GET /intents/:id/relevant`, `POST /negotiate`, `POST /me/link-code`, `GET /stream`.

## Acceptance
- Loads with mocked JSON matching the contracts and renders 30 public intent cards with no console errors.
- An intent card whose free text contains `<img src=x onerror=alert(1)>` renders as visible text and runs nothing.
- Clicking a non-relevant intent card shows no message button.
- With the real API, confirming a draft makes a public intent card appear within 2 seconds on a second browser.
- Approving in the panel and approving by SMS reach the same state. Both views update.
- Works at phone width (the demo may be shown on a phone).

## Notes
- Locations and map-based discovery are deferred until they are explicitly restored to the intent model.
- Keep the UI plain and focus on the intent feed and agent activity.
- Add the Sentry browser SDK in slice 10.