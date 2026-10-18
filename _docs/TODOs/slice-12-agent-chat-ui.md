# Slice 12: agent chat UI

Spec: [12_agent_chat_ui.md](../12_agent_chat_ui.md). Replaces the panel layout from slice 09.

## Workstream 1: state and wording
- [x] `ChatMsg` type and `chat` / `postChat` in `hooks/liveContext.ts` and `hooks/live.tsx`.
- [x] `lib/agentSpeech.ts`: pure functions that turn an event or a negotiation result into agent text (nothing found, match found, needs your call, final price, price came down and next suggestion, committed, dissolved, vacated). Direction depends on whether the user pays or receives.
- [x] Map stream events to chat messages in `LiveProvider`.
- [x] `api.arrangementAction` returns `{ status, reason?, amountCents? }` (client, mock, types).

## Workstream 2: chat panel
- [x] `panels/AgentChat.tsx`: scrolling timeline, pinned input, empty-state greeting.
- [x] Draft flow in chat: free text creates a draft, the agent summarises it, Post and Discard buttons, a question from the parser is answered by the next message. A draft passed in from My intents (reopen) shows the same way.
- [x] Embed the arrangement card (approve, decline, counter) in agent messages by `arrangementId`. Seed pending and committed arrangements after a reload.
- [x] Card actions post the user's message and the agent's reply into the chat. Negotiate-further outcomes post "final price" or the new price plus a suggestion button.
- [x] "Message their agent" from a feed card reports its outcome in the chat.
- [x] Negotiable-price case: the agent asks what the user would pay.

## Workstream 3: layout
- [x] `Dashboard.tsx`: left My intents, middle chat, right all intents. Phone tabs: Mine, Agent, Feed.
- [x] Floating collapsible agent-to-agent window at the bottom right, with a badge. Reuse `Conversations`.
- [x] Remove `Composer`, `Approvals` list, `AgentFeed` from the page and delete dead code. Keep `ApprovalCard`.

## Workstream 4: channel toggle
- [x] Migration adding `users.channel` (default `app`) and `GET` / `POST /me/channel` (409 for `sms` without a verified phone).
- [x] Outbound router: agent messages go to the SSE stream or the Photon adapter based on the active channel, never both.
- [ ] Inbound rule: SMS from a user on `app` gets a single reply explaining how to switch, nothing else.
- [x] Chat header toggle, the linking prompt when no phone exists, and the banner while on SMS.
- [ ] Re-send open questions on the new channel when the user switches (not built: open questions stay in the chat, and SMS only gets new messages).
- [ ] Channel-neutral action handling shared by the buttons and the SMS parser (needs slice 08 inbound).

## Workstream 5: tests and verification
- [x] Update and add vitest tests: agent speech functions, draft flow in chat, card inside chat, window collapse.
- [x] `npm test`, `npm run lint`, `npm run build` clean.
- [x] Browser check on mock data at desktop width (phone width not checked).
- [x] Update `09_map_ui.md` and the slice 09 TODO with a pointer to this slice.

## Out of scope
- LLM-written agent wording, the Photon adapter itself (slice 08, which this slice only routes to), and server-side chat history.

## Implementation notes
- Outbound routing is in `backend/src/channel/service.ts` and runs in the SSE bridge for `notify` events. On `sms` the text goes to the sender (a console logger until slice 08 provides Photon) and the app stream gets nothing.
- `POST /me/phone` stores a number as unverified. SMS needs a number on file, not a verified one, until slice 08 adds verification.
