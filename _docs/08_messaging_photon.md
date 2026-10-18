# 08 Messaging (Photon Beta)

**Spec:** 6.15, G16, A8. **Depends on:** 01, 02, 07. **Feeds:** the demo's main interface and the Photon challenge.

> **Channel toggle:** SMS is opt-in. A user is on either app chat or SMS, never both, and needs a verified phone to choose SMS. See [12_agent_chat_ui.md](12_agent_chat_ui.md).

Goal: users create intents, answer questions, approve, and receive contacts by text. Inbound text uses the same agent-chat handler as in-platform chat, preserving the existing intent, negotiation, and arrangement rules.

## Components (`channel/`)

```
photon.ts        Photon Beta REST sender and cursor-backed Socket.IO consumer
inbound.ts       replay-safe inbound routing to the shared agent-chat handler
linking.ts       time-limited phone verification
service.ts       active-channel choice and notification text
```

`CHANNEL=photon` connects to Photon Beta (2.0); `CHANNEL=terminal` retains the local console sender.

## Photon Beta setup

- Create a Beta project at [app.beta.photon.codes](https://app.beta.photon.codes), connect an eligible SMS line, and obtain its `pho_usr_...` sender ID and E.164 number.
- Create a project API key with `project:read` and `project:write`; keep it server-side. Required environment values are `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `PHOTON_SENDER_ID`, and `PHOTON_PHONE_NUMBER`.
- Inbound events use Beta's authenticated Socket.IO event stream; the backend checkpoints the `message.received` event cursor in PostgreSQL. No Stable Spectrum webhook secret or webhook URL is used.
- Beta SMS sending depends on platform authorization and any applicable campaign/sender registration. Confirm line eligibility and test a real SMS before launch.

## Linking a phone to an account

1. After Clerk sign-in, the user selects SMS and enters a number. The app shows a 4-digit code and the configured Photon number (`POST /me/link-code`).
2. The user texts the code to the configured number. That first inbound text establishes the Photon conversation; the handler matches the code to the exact phone, sets `phone_verified`, switches the channel to SMS, and stores the Beta user and space IDs.
3. Unknown numbers get one linking-instruction reply. No other processing occurs.
4. A phone change returns the user to app chat until the new number is verified.

## Inbound routing (`inbound.ts`)

1. Process only Beta `message.received` text events for SMS or iMessage with a phone sender and unseen message ID.
2. Match a pending, expiring verification code to the exact sender phone. Invalid attempts are capped.
3. Unknown numbers receive one linking instruction. A verified user whose active channel is app is not processed over text.
4. `STOP` switches back to app chat; `HELP` explains the text interface.
5. Other messages are appended to the shared chat history and sent to the same `runAgentChat` handler used by the web UI. Existing listing, negotiation, ownership, approval-revision, and price checks remain authoritative.

An approval still requires a clear user message against current arrangement terms. If multiple deals are pending, the agent must clarify. Event delivery is at-least-once: the provider message ID is deduped, and the cursor advances only after successful handling.

## Outbound

Send through Beta `POST /v1/projects/{projectId}/messages`, using the configured sender ID, stored conversation space ID, and an idempotency key per message segment. Log every send and receive to `sms_log`.

| Kind | Content |
|---|---|
| `approval_request` | Structured give/get/cash details and a clear approve/pass prompt |
| `needs_user` | Price question and negotiation prompt |
| `nothing_found` | Short status and suggestion |
| `dissolved` | Arrangement fell through |
| `committed` | Direct counterpart names and contacts |

Rules:
- Dedupe notifications by `(userId, kind, refId)` and inbound messages by provider message ID.
- Keep text segments under about 320 characters.
- Skip quiet hours entirely for v1.
- The web app remains the source of truth.

## Prompt-safety

Handles and any text from other users are not included in outbound messages except system-generated counterparty handles. Never include another user's free text in an SMS.

## Acceptance

- An unverified user cannot select SMS or receive account notifications by text.
- A code sent from the exact sender phone verifies it and switches to SMS; subsequent messages reach the same chat handler as the web UI.
- Replayed Beta event IDs neither run a second agent turn nor send a second reply.
- Committed-arrangement texts include only direct counterpart contacts.
- No outbound text includes a private bound or another user's free-text listing.

## Notes

- The Beta event stream requires a persistent, shared cursor store; use a single backend instance for this consumer unless multi-instance coordination is added.
- SMS availability, line authorization, and compliance depend on the Photon project and destination region; SDK/API support alone does not guarantee carrier delivery.
