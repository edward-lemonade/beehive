The# 12 Agent Chat UI (redesign of slice 09)

**Replaces:** the panel layout in 09 (Composer, Approvals, AgentFeed, Agents tabs). **Depends on:** 02, 03, 06, 07, 09. **Later:** 08 (Photon) reuses the same agent messages over SMS.

## Goal
The user talks to one agent. Everything that needs the user happens in that conversation. Agent-to-agent traffic is a debugging aid, not a screen the user has to read.

## Layout
Three columns on wide screens, and three tabs on phones (Mine, Agent, Feed).

| Left | Middle | Right |
|---|---|---|
| My intents (scrolls) | Chat with my agent (scrolls, input pinned at the bottom) | All open intents (scrolls) |

A floating **Agent-to-agent window** sits at the bottom right. It is collapsed to an icon by default, with a badge for new messages. Expanded, it holds the existing per-counterparty tabs with chat bubbles (my agent on the right, theirs on the left). It stays a scrollable panel and keeps the history persistence added earlier.

Removed from the page: the standalone Composer, Arrangements list, Agents panel and Agent activity feed.

## Chat behavior
Message types, all rendered as chat bubbles (agent on the left, user on the right):

1. **Intent entry.** Any free text the user types becomes a draft. The agent answers like a person, for example "Got it: you're selling a Saturday NiteHarts ticket for $100. Post it?", with Post and Discard buttons. If the parser needs more, the agent asks, and the next message is the answer. No field forms.
2. **Findings.** When a match exists, the agent describes it in words (who, what, price) and asks. There are no approval cards or buttons: a clear yes, sure or similar from the user is the approval, a no declines, and naming another price renegotiates. Committed deals show their checklist in the chat. Pending arrangements are re-announced after a reload from `GET /arrangements/mine`.
3. **Nothing found.** The agent says it found nothing and suggests a price change that helps this side: sellers go lower, buyers offer more. It says it will keep watching.
4. **Negotiation.** The agent always tries to negotiate with the other agent first.
   - If the other agent does not budge, the agent tells the user "<handle> won't go below $X. That's their final price."
   - If the other agent moves, the agent reports the new price and suggests the next step with a one-tap button: lower for a buyer, higher for a seller, about 10% each time.
   - If the user never gave a price (negotiable), the agent cannot know what they would accept, so it asks: "<handle> wants $X. What's the most you'd pay?" The reply goes to the other agent as a counter.
   - If the counterpart's agent comes back with a price below the user's ask, the agent asks the user whether to accept it.
5. **Outcomes.** Approved, declined, committed (the card shows the terms and each counterparty's contact; the platform does not track fulfilment), dissolved, and a dropped participant each get a short plain message.

The agent writes with fixed, friendly templates. An LLM rewrite of the wording is optional later, and no price or decision is ever taken from model text.

## Data flow
- Chat state lives in `LiveProvider` next to the existing stream handler. It holds `chat: ChatMsg[]` and exposes `postChat`.
- `ChatMsg` is `{ id, at, from: 'agent' | 'me', text, arrangementId?, suggest?: { arrangementId, cents } }`.
- Stream events map to agent messages: `notify` kinds `nothing_found`, `approval_request`, `needs_user` (payer or receiver side), `committed`, `dissolved`, `near_miss`, plus `slot.vacated`.
- The `needs_user` payload already carries `side`, `amountCents`, `counterpartHandle`, `intentId` and `arrangementId`.
- `api.arrangementAction` now returns the result of `negotiate-further` (`status`, optional `reason`, new price), so the card can post "came down to $90" or "won't budge" into the chat.
- The same outcome text is used for the "Message their agent" action on a feed card.
- Chat history is kept in memory. Anything that needs action (pending arrangements, an open draft) is rebuilt from the API on reload.

## Channel toggle (chat or SMS)
- Each user has one **active channel**: `app` (default) or `sms`. Only that channel carries agent-to-user conversation. The other stays silent, so the user never gets the same question twice.
- A toggle in the chat header switches it. Choosing SMS requires a linked phone number (slice 08 linking). Without one, the toggle opens the linking steps and stays on `app`.
- The backend stores it as `users.channel` (`'app' | 'sms'`, default `'app'`) with `GET /me/channel` and `POST /me/channel`. The POST rejects `sms` with 409 when no verified phone exists.
- A single outbound router decides where every agent message goes. The agent produces one message (same text and actions), and the router sends it to the SSE stream when `app` is active or to the Photon adapter when `sms` is active.
- Inbound follows the same rule. Texts from a user whose channel is `app` get one reply telling them SMS is off and how to turn it on, with no other processing. Messages typed in the app while `sms` is active are not sent. The chat shows a banner "Your agent is texting you. Switch back to chat to continue here" with a switch button.
- Switching mid-conversation re-sends any still-open question (a pending approval, a draft, a price question) on the new channel and marks it as moved on the old one.
- Actions are channel-neutral: the same `approve`, `decline`, `counter <amount>`, `post` and `discard` intents come in from buttons or from parsed SMS replies.
- Observation-only views (my intents, all intents, agent-to-agent window) keep working in both modes.

## Backend
No new routes. Small additions only if a gap shows up (for example the intent text in the `nothing_found` payload). The agent-to-agent logic from 06 and 07 stays as it is.

## Acceptance
- The page shows exactly three areas plus the collapsed agent-to-agent icon.
- Typing "selling saturday niteharts ticket for $100" produces a draft message with Post and Discard, and posting adds the intent to the left column and the right column.
- Toggling to SMS without a phone prompts linking and stays on chat. With a phone, agent messages move to SMS and the chat shows the banner. Toggling back moves them again, with no duplicates.
- A match is put to the user in words. Saying "sure" approves it, and the agent reports whether the deal is committed or waiting on the other side.
- Asking for a lower price that the other agent refuses gets "final price" from the agent. A price that the other agent accepts gets a follow-up suggestion.
- A negotiable buyer is asked for a price rather than being told one.
- No match produces a "found nothing" message with the right-direction price suggestion.
- The agent-to-agent window opens and closes, and shows the conversation per intent pair.
- Works at phone width.

## LLM-backed chat (supersedes template replies)

Free text in the chat goes to `POST /agent/chat` (`backend/src/agent/chat.ts`). The agent sees the user's intents, other users' open listings and pending arrangements, then replies in its own words. It may request one action per step: `message_agent`, `negotiate_arrangement`, `approve_arrangement`, `decline_arrangement`, `retract_approval`, `keep_looking`. The server executes it (ownership enforced by the services) and feeds back a `TOOL RESULT` for up to 4 steps. Approval actions run only when the request carries a user message, never for an `event`. The agent cannot create intents; the New intent box does that. System events can be passed as `event` so the agent narrates them.

### Authoritative proposal updates

Price/approval notifications also go through the chat model. There is no
scenario-specific reply or fixed price-notification template. The backend
supplies current persisted terms and offer provenance to the model, and removes
cached amounts from approval events. Old event amounts and chat messages are not
sources of truth. A buyer's $90 opening must never be described as the seller's
accepted price.

`TermsView.proposal`, when present, contains the active `amountCents`,
`otherHandle`, `awaiting` (`user` or `counterparty`), and, for new proposals,
`source` (`agent` or `user`). Cash and net amounts in
that view reflect the active proposal, not the superseded price stored on the
link. The proposal is not an agreement. A $100 counter from dawg therefore shows
$100 to both sides: edward is asked to answer, while dawg is told to wait.
Initial single-link negotiations that stop for a user's decision also persist
the proposal: the $90 opening is attributed to edward's agent, with dawg answering.
Accepting an agent-originated opening does not auto-approve the originating user;
only a user-named proposal carries that user's consent.

Creating, replacing, accepting, or rejecting a proposal increments the revision
and publishes `arrangement.updated` after persistence. Changed proposals clear
the affected users' previous approvals. Notifications use revision-based keys,
ignore superseded in-flight responses, and surface request errors instead of
substituting a generic success message. In-flight negotiation events for
arrangements do not announce prices before persistence.

Every executed chat tool refreshes the model's authoritative context before the
next model step. Approval tools check the current proposal amount and pass the
same revision into the serialized approval operation, so a concurrent counter
cannot turn approval of an old price into approval of a new one.

Backend unit checks stub the model to verify its factual inputs and that its
returned text is used unchanged; they do not validate live-model wording.
Seed definitions contain listings, not agent responses.
