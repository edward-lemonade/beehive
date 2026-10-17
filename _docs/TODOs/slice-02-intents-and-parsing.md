# Slice 02 TODOs: Intents and Parsing

## Goal
Implement the intent lifecycle: create parsed drafts, ask missing questions, confirm drafts into open intents, manage versions and edits, and expose the required routes.

## Workstream 1: parser and draft flow
- [x] Define the parsed intent schema and validation rules in backend contracts.
- [x] Implement production raw-text parsing through an OpenAI-compatible LLM endpoint in JSON mode, with a deterministic parser helper for fixed examples.
- [x] Normalize item labels and attributes for ticket/sublet/cash entries.
- [x] Handle cash flex semantics and `minNetCents`/`declaredNetCents` inference rules for the core parsing cases.
- [x] Detect and flag injection attempts (`injectionSuspected`) without blocking the parse.
- [x] Implement draft validation for required fields and incomplete data.
- [x] Ask one missing question at a time and enforce the 48h draft lifecycle.
- [x] Support the separate-or-together quantity flow for multi-ticket drafts.
- [x] Add tests covering 10 fixed parser examples and injection behavior.
- [x] Snapshot structured output from a mocked LLM once the isolated LLM parser is integrated.

## Workstream 2: versioning
- [x] Add version tracking and per-version snapshots for edits in PostgreSQL.
- [x] Persist confirmed intents and `intent_versions` snapshots in PostgreSQL, including atomic edits, state changes, and open-intent limits.
- [x] Preserve `privateOnly` behavior on `intent.updated` so discovery can skip re-notice.
- [x] Ensure draft confirms emit `intent.opened` exactly once.

## Workstream 3: service layer and routes
- [x] Implement `createDraft`, `answerDraft`, `confirmDraft`, `editIntent`, `withdrawIntent`, `expireDue`, and `reopen`.
- [x] Add the Clerk-authenticated routes for draft creation, answering, confirming, editing, withdrawing, reopening, and listing own intents.
- [x] Ensure public intent responses never return private fields.
- [x] Add route-level access control and authorization checks for user-owned intents.

## Workstream 4: acceptance and regression checks
- [x] Confirm the expected ticket sale acceptance case parses correctly.
- [x] Validate public intent output omits private fields and private bounds in text.
- [x] Verify confirming a draft emits `intent.opened` exactly once.
- [x] Check the 10 fixed parser examples and edge-case injection examples pass.
- [x] Snapshot outputs from the isolated LLM parser after it is integrated.
- [x] Confirm the service route surface matches the Slice 02 endpoints.
- [x] Apply the migration to a PostgreSQL database (verified by the user against a local instance).
- [x] Verify live LLM parsing with a free provider (Gemini).
- [ ] Deferred to the frontend slice (09): verify Clerk-authenticated routes with a real session token. Unauthenticated rejection is covered by tests.

## Dependencies
- Depends on: Slice 01 foundation and contracts.
- Feeds: Slice 03 discovery/relevance, Slice 08 messaging, Slice 09 public intent feed.

## Notes
- Keep parsing and extraction isolated from discovery and pricing logic.
- No free text is used for matching or agent-to-agent decision-making.
- Location and radius are not features of current intents; future location work will require a deliberate model and discovery update.
- Use structured output from the LLM and validate with Zod at every boundary.
- Confirmed intents and versions are PostgreSQL-backed; unconfirmed 48-hour drafts remain process-local and are lost on restart.
