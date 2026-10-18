# 11 Seed, Deploy, and Demo

**Depends on:** all slices. Start the deploy parts early (day one), since cloud setup is where hackathons lose hours.

Goal: a one-command reset to a known state, a deployed system, and a rehearsed demo that runs at demo speed.

## Deploy

### Environment

- For the API, copy `backend/.env.example` to `backend/.env` and fill in each blank required value. The template documents where to get each credential and shows the Supabase PostgreSQL URL shape.
- For the web app, copy `frontend/.env.example` to `frontend/.env` and fill in the Clerk publishable key. Use the deployed API URL for `VITE_API_URL` outside local development.
- For `npm run db:migrate`, provide `DATABASE_URL` in the environment. Prefer Supabase's direct connection URL for migrations; use the session pooler URL for a deployed API.
- Never commit either `.env` file or share secret keys. Keep the Clerk secret, LLM API key, Photon credentials, database password, and Sentry DSNs private.
- `CHANNEL=terminal` avoids sending messages through Photon during local development; Photon credentials are required only when `CHANNEL=photon`.

| Piece | Host | Notes |
|---|---|---|
| API + agents + Photon adapter | Render web service | One instance only. Use a paid instance, or the free tier plus a keep-warm ping before the demo, since free services sleep and in-memory agents are rebuilt on wake. |
| Postgres | Supabase | Use the pooled connection string for the app and the direct one for migrations. |
| Web | Vercel | Set `VITE_*` vars. Add the Vercel domain to Clerk's allowed origins. |
| Auth | Clerk | One development instance is enough. |
| Messaging | Photon | Webhook URL must be public HTTPS (the Render URL). Register the team's phones. |
| Monitoring | Sentry | Two projects (api, web), or one with two DSNs. |

Steps:
1. Create Supabase project, run migrations (`npm run db:migrate` in `backend/`).
2. Render: root directory `backend`, build `npm install && npm run build`, start `node dist/index.js`, set all env vars, set health check `/health`.
3. Vercel: root directory `frontend`, framework Vite, set env vars.
4. Point Photon webhook (if used) at the Render URL. Test with one message.
5. Smoke test: sign in, post an intent, see it in the public intent feed, see a Sentry transaction.
6. Write the steps into `docs/deploy.md` as you do them.

**Where do agents run for the demo?** In the Render API process. They are cheap objects, not services. Two options for the recording:
- **Deployed (default):** the real stack with `TIME_SCALE` raised so approval windows take seconds.
- **Local with a tunnel:** run the API locally behind a tunnel (for example Cloudflare Tunnel or ngrok) so Photon webhooks reach it. Faster iteration, no sleep risk, and logs on screen. Use this if Render is flaky on the day.

## Demo speed
- `TIME_SCALE=300` makes the 24-hour approval window about 5 minutes. For the video, `TIME_SCALE=1440` makes it a minute.
- LLM calls are not scaled. If they are slow, record at real speed and speed up the video in editing. Cut dead air, not agent activity.
- Add `NEGOTIATION_ROUNDS=3` and a visible 500 ms delay between rounds in demo mode (`DEMO_MODE=true`) so the feed is readable.

## Seed data (`seed/`)

### In-app datasets

In development, **Load seed data** opens a mini-modal listing datasets from
`GET /dev/seeds`. Choose a dataset and confirm with **Load selected dataset**.
`POST /dev/seed` accepts `{ "scenarioId": "ticket-swap" }` or
`{ "scenarioId": "ticket-shopping" }`; omitting `scenarioId` keeps the original
swap as the default. Both endpoints require authentication and are unavailable
in production.

- **Original: three-way ticket swap** (`ticket-swap`): edward offers Saturday
  and Sunday tickets for a 3-day ticket; acmm wants Saturday and Sunday tickets;
  dawg offers a 3-day ticket for $200.
- **Ticket shopping: find a better deal** (`ticket-shopping`): acmm offers a
  ticket for $100 non-negotiable, dawg offers a ticket for $110 negotiable,
  and edward looks for a ticket without specifying a price. Sellers are posted
  before the buyer so both options are available when negotiation begins.

Loading either dataset replaces these three accounts' existing listings. Each
account must have signed in once with its matching handle. Mock mode can display
the options but cannot load live seed data.

For a simple purchase without a buyer-named price, the negotiator compares
matching firm listings for the same wanted item. If a negotiable seller's ask
is higher, it opens 10% below the cheapest comparable firm price. In the shopping
dataset edward's agent asks dawg, **"Could you do $90?"**, using acmm's $100
listing as the benchmark. This is an opening request, not a claim that dawg has
accepted; dawg must approve a price below the negotiable ask, and edward must
also approve before a purchase commits. Without a cheaper comparable firm
listing, the existing ask-price opening is unchanged. Explicit user prices and
firm seller prices are not discounted.

Seed users have verified phones. The team's own phones are three of them.

Commands:
- `npm run seed:base`: about 25 background intents with ticket, sublet, and gear items. Includes tiers (mostly `new`, a few `reliable`).
- `npm run seed:s1`: inserts nothing, prints the three intent texts for A, B, and C to type or text live.
- `npm run seed:chain`: pre-opens A, B, and C of a 4-chain and prints D's text. Opening D completes the cascade.
- `npm run seed:replace`: a spare seller D2 who can fill C's slot, for the decline demo.
- `npm run seed:attack`: nothing to seed; the `/demo/*` routes cover it.
- `npm run reset`: truncates all tables, re-seeds users and base data, restarts agents (calls `rehydrate`).

Required seed cases:
1. **S1 three-party:** A "want Coachella Friday ticket, up to $60" (bound $60 stated privately), B "have Friday ticket, want Saturday ticket", C "have Saturday ticket, want $50".
2. **Chain of 4** via `seed:chain`.
3. **Near miss:** a buyer capped at $300 and a firm $315 seller of the same item.
4. **Swap with top-up (S10):** user with Fri + Sat tickets wants a 3-day pass, two buyers and a $300 seller.
5. **Injection intent:** a visible intent with an instruction in its text.
6. **Replacement:** D2 in place, so a decline does not dissolve the arrangement.

## Demo script (3 minutes, with a fallback for each beat)
1. **(20s) The public feed.** Show public intents. "No listings to browse for your agent, only for you."
2. **(30s) Text an intent.** From a real phone, text A's intent to the Photon line. Draft reply arrives. Reply YES. The intent appears in the public feed.
3. **(45s) The cascade.** Text B, then C. Open the agent feed and the Sentry trace on a second screen: B wakes, signals A and C, coordinator creates the arrangement, agents negotiate rounds with `say` lines.
4. **(30s) Approvals.** Approval SMS arrives on three phones. A approves by text, B in the app, C declines on purpose.
5. **(30s) Repair.** Replacement D2 fills C's slot. Only D2 is asked. A and B are not messaged. D2 approves, commit, contacts released by text.
6. **(25s) Sentry.** Fire `/demo/attack`. The privacy canary alert appears. Show the trace waterfall and the deal funnel dashboard.
Fallbacks: terminal adapter if Photon fails (`CHANNEL=terminal`), pre-recorded trace screenshot if Sentry is slow, `npm run reset` between takes.

## Rehearsal checklist
- Run the full script twice from `npm run reset`.
- Record one clean take at real speed as a backup before attempting the sped-up one.
- Check phones: Photon registered, notifications on, correct numbers linked.
- Check Sentry: dashboards load, alert rules enabled, trace for S1 exists.
- Hide `DEMO_MODE` routes behind an env flag and turn it off outside the demo.

## Acceptance
- `npm run reset` returns to the base state in under 10 seconds.
- The S1 demo runs start to finish three times in a row without manual repair.
- Killing and restarting the API mid-negotiation recovers (slice 05 rehydration) and the demo can continue.
- A clean clone follows `docs/deploy.md` to a working deployment.

## Notes
- If time runs short, cut in this order: S10 seed, chain-of-4 seed. Keep S1, replacement, near miss, and the attack demo.