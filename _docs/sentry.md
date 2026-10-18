# Sentry in Beehive

What is wired up, how to turn it on, which dashboards and alerts to create, and a demo script. The design spec is [10_observability_sentry.md](./10_observability_sentry.md).

## Setup

Backend (`backend/.env`):

| Var | Meaning |
|---|---|
| `SENTRY_DSN_API` | Backend project DSN. Empty means Sentry is off. Also off under Vitest. |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Optional tags. |
| `SENTRY_RECORD_LLM_IO` | `false` by default. When `true`, prompts and completions are attached to `gen_ai` spans. Leave it off for real users, because chat prompts contain private price limits. |
| `DEMO_MODE` | `true` mounts the `/demo/*` routes. |

Init lives in `backend/src/instrument.ts`. It is preloaded with `node --import ./src/instrument.ts` (see the `dev` and `start` scripts), so do not call `Sentry.init` anywhere else. `index.ts` only adds the Hono request middleware: `sentry(app)` from `@sentry/hono/node`.

Frontend (`frontend/.env`):

| Var | Meaning |
|---|---|
| `VITE_SENTRY_DSN` | Browser project DSN (a separate React project is recommended). Empty means off. |
| `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE` | Optional. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Build time only. They upload source maps with `vite build` and delete them from `dist` afterwards. |

## What each product is used for

| Product | Where | Why it matters here |
|---|---|---|
| **Tracing** | `runtime/bus.ts`, `runtime/scheduler.ts`, `runtime/registry.ts` | Trace headers ride inside every agent envelope and every scheduled wake. One trace runs from the browser click, through the API, through every agent that woke, to the LLM calls they made. Look for `agent.wake` and `agent.receive` spans. |
| **AI Agent monitoring** | `observability/llm.ts`, `agent/chat.ts` | All 4 LLM call sites (`intent.parse`, `negotiation.wording`, `discovery.semantic`, `agent.chat`) emit `gen_ai.chat` spans with model, tokens and latency. The chat agent emits `invoke_agent` and `execute_tool` spans, so the AI Agents dashboard shows tool errors, guardrail blocks and step loops. |
| **Online evals** | `observability/evals.ts` | Every chat turn is graded: grounded prices (no invented `$` amounts), forbidden phrases, guardrail blocks, tool failures, step budget, prompt leak, reply length. Scores are span attributes (`eval.*`) and an `agent.eval.score` metric. Each failing grader opens its own issue. |
| **Security signals** | `observability/security.ts` | Prompt-injection heuristics run on listings, chat messages and agent messages, alongside the parser's own `injectionSuspected` flag. A canary token sits in the system prompt, and replies are scanned for it and for prompt phrases. Only rule ids, length and a hash are sent, never the text. |
| **Invariant monitors** | `observability/monitors.ts` | Bus guard violations (privacy leak is fatal, gossip and schema are errors), out-of-bounds offers (fatal), stalled negotiations, and exhausted engine budgets. |
| **Metrics** | throughout | `deal.funnel{stage}`, `deal.time_to_commit`, `negotiation.outcome`, `negotiation.rounds`, `negotiation.duration`, `negotiation.awaiting_user`, `agent.tool_call{outcome}`, `agent.eval.score`, `agent.eval.grade`, `agent.wake.duration`, `llm.call`, `llm.tokens`, `llm.latency`, `security.injection`, `security.prompt_leak`, `bus.violation`, `engine.budget_exhausted`, `notify.sent`, and from the browser `agent.reply_feedback`. |
| **Logs** | `telemetry.ts` `log.*`, console integration | Structured logs carry the same scrubbed attributes as spans, so you can jump from a log line to its trace. |
| **Profiling** | `instrument.ts` (`profileLifecycle: 'trace'`) | Shows CPU hot spots in the engine and matching paths on the same traces. |
| **Session Replay** | `frontend/src/lib/sentry.ts` | 100% of sessions, with all text and inputs masked. Clicks, layout and timing remain. |
| **User Feedback** | 👎 button on agent replies, plus the "Report a problem" widget | A 👎 attaches the replay and counts toward `agent.reply_feedback`. This is human eval signal sitting next to the automated graders. |
| **Uptime** | `GET /health` | Runs `select 1` and returns 503 if the database is down. Point an Uptime monitor at it. |

## Dashboards to build

1. **Deal funnel:** `deal.funnel` count, grouped by `stage`, as a bar chart. Add a second widget filtered to `stage:dissolved` and grouped by `reason` ("where deals die").
2. **Agent quality:** `agent.eval.score` p50/avg over time; `agent.eval.grade` where `result:fail`, grouped by `grader`; `agent.tool_call` grouped by `outcome`; `agent.reply_feedback` count.
3. **LLM cost and latency:** `llm.latency` p95 grouped by `function_id`; `llm.tokens` sum grouped by `function_id` and `model`; `llm.call` where `outcome != ok`.
4. **Security:** `security.injection` grouped by `surface`; `security.prompt_leak`; `bus.violation` grouped by `rule`.
5. **Negotiation health:** `negotiation.outcome` grouped by `state` and `reason`, plus `negotiation.rounds` and `negotiation.duration` distributions.

## Alert rules

- Issue alert, immediate: error type is `PrivacyLeakError`, `PromptLeakError`, or `BoundsViolationError`. Each of these should never happen.
- Issue alert: `GossipViolationError` or `BusContractError`.
- Metric alert: `security.injection` above 3 in 10 minutes (an injection spike).
- Metric alert: average `agent.eval.score` below 0.8 over 30 minutes (agent quality regression).
- Issue alert: title contains "Negotiation stalled".
- Uptime monitor on `https://<api>/health`.

## Demo script (`DEMO_MODE=true`)

Each route drives a real detector with a canned input:

```sh
API=http://localhost:3000
curl -XPOST $API/demo/inject       # prompt-injection warning; payload grouped by hash
curl -XPOST $API/demo/rogue-agent  # agent messages a stranger; guard drops it and opens a GossipViolation issue
curl -XPOST $API/demo/prompt-leak  # canary found in output; fatal PromptLeakError
curl -XPOST $API/demo/bad-reply    # eval fails grounded_prices and no_guardrail_block; agent span shows the scores
curl -XPOST $API/demo/slow         # 1.5 s span to find in the trace waterfall and profile
curl -XPOST $API/demo/crash        # unhandled route error with request context
```

For the live story: open the app, send the agent a message, click 👎 on its reply, then open the feedback in Sentry. It links to the replay, and from there to the backend trace showing the `invoke_agent` span, its tool calls, its LLM spans and its eval scores.

## Privacy

Sentry never receives phone numbers, emails, listing or chat text, or private bounds.
- `dataCollection` turns off cookies, headers, bodies, query strings and stack locals.
- `scrub.ts` redacts phones, emails and bearer tokens in events, span names, span attributes and logs, and drops sensitive attribute keys.
- Security events send only rule ids and a hash.
- Replay masks all text and inputs.
- Users are identified by internal id and handle only.
