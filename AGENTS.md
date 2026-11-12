# AGENTS.md — OpenVibe.Fun

## Project Overview

OpenVibe.Fun is the Fun room: IRL quest boards attached to a public OpenVibe.Live channel, a deterministic
"what's fun near me" guide from OpenStreetMap (Ticketmaster only when a key is configured), and group plans with one
vote each and a winner the viewer can add to their own OpenVibe.Today.

- **Domain:** `openvibe.fun` · **Port:** 5140 · **Service id:** `fun` · **Env prefix:** `FUN`
- **Runtime:** Node 22, Express 4, PostgreSQL 18 through `openvibe-sdk/db` (embedded PGlite in development/tests),
  Valkey 9 for shared limit counters.
- **Read first:** [README.md](README.md) (ownership, API and safety rules) and [STATUS.json](STATUS.json).

**Network context:** identity, roles and the OpenCoins wallet are OpenVibe.Network (OAuth client `fun`, PKCE S256;
staff means Network role `global_mod` or above). Fun **reads** Live's public channel state and Chat's public history
through `server/upstreams.js`; it never posts to Live or Chat. Today is written only with the signed-in person's own
Network token (`server/today.js`). Account export/deletion arrives from OpenVibe.Events at `/internal/events`. Search
documents wait in `fun_outbox` and are delivered by `openvibe-publishing/search-relay` (`server/search.js`). Fun owns
no other service's state.

## Commands

```bash
npm ci                         # install (the repo pins contracts/sdk/shared by tag)
npm run dev                    # http://localhost:5140, NODE_ENV=development
npm start                      # node server/index.js
npm test                       # every test/*.test.js in its own process, temp PGlite, mocked Network/upstreams
npm run test:pg                # the same through PostgreSQL + PgBouncer (openvibe-sdk scripts/test-services.sh up)
npm test -- quests             # only test files whose name contains the word
npm test -- --strict           # a skipped test fails the run
node --check <file.js>         # syntax check (no linter/formatter in this repo)
```

`test/run.js` uses `openvibe-shared/test-runner`; tests never reach the internet — upstream fixtures are local. There
is **no build step**: pages are server-rendered and assets are served from `public/` with content-hash cache headers.

## Architecture at a Glance

- **Entry:** [server/index.js](server/index.js) — starts the listener, telemetry tick/retention, the read-only chat
  sync, the OpenCoin retry timer and the Events subscriptions; `FUN_DRILL` keeps boot-time work off. Graceful stop is
  `createLifecycle()` in the same file.
- **App factory:** [server/app.js](server/app.js) — helmet/CSP, SSO middleware, `/auth`, `/internal/events`,
  `/shared` + static, `/api/v1`, the agent layer (Markdown twins and `/.well-known/agent.json`), pages, 404 and error
  handler. Tests build this app with `createApp({ store, fetchImpl, ... })`.
- **Config:** [server/config.js](server/config.js) — `load(env)` is pure; production reads `/etc/openvibe/fun.env`.
  Only variable **names** appear in code and docs.
- **Database:** [server/db.js](server/db.js) — migrations in [migrations/](migrations/) run at boot with
  `DATABASE_DIRECT_URL` (owner); `DATABASE_URL` serves through PgBouncer. No table is created at runtime.
- **Store/domain:** [server/store.js](server/store.js), [server/quests/](server/quests/) (`ideas.js`, `safety.js`),
  [server/guide/](server/guide/) (`index.js`, `places.js`, `upstream.js`, `events.js`),
  [server/chat-sync.js](server/chat-sync.js), [server/coins.js](server/coins.js),
  [server/sharing.js](server/sharing.js), [server/today.js](server/today.js).
- **HTTP:** [server/http/router.js](server/http/router.js) is the async router; [server/http/api.js](server/http/api.js)
  mounts `/api/v1`, [server/http/pages.js](server/http/pages.js) the pages, [server/http/principal.js](server/http/principal.js)
  decides person vs service token and capabilities. Views are under [server/views/](server/views/).
- **Auth:** [server/auth/sso.js](server/auth/sso.js) + [server/auth/keys.js](server/auth/keys.js) — Network OAuth2
  PKCE and offline JWKS verification; staff from the Network role claim ([server/identity/staff.js](server/identity/staff.js)).
  Account export/deletion: [server/identity/account-data.js](server/identity/account-data.js).
- **Frontend:** server-rendered HTML through [server/render/layout.js](server/render/layout.js) and
  [server/render/html.js](server/render/html.js), which pull the OpenVibe Frame/kit from `openvibe-shared`. Assets:
  [public/css/fun.css](public/css/fun.css), [public/js/fun.js](public/js/fun.js). Pages work without JavaScript; JS
  only adds convenience. Markdown twins come from [server/agent-pages.js](server/agent-pages.js) and
  [server/agent-descriptor.js](server/agent-descriptor.js).
- **Deploy:** [deploy/systemd/openvibe-fun.service](deploy/systemd/openvibe-fun.service) (127.0.0.1:5140,
  `/etc/openvibe/fun.env`) and [deploy/nginx/openvibe.fun.conf](deploy/nginx/openvibe.fun.conf) (TLS, www → apex,
  `/internal` and `/metrics` closed). `sudo ovhost deploy fun` on the host; database `ov_fun`; /opt/openvibe.fun.

## Ownership and Boundaries

Fun is the authority for the tables its migrations create: quest boards/quests/votes/checks/badges/rewards, plans and
their options/votes, `fun_reports`, `fun_chat_seen`/`fun_chat_cursors`, `fun_geo_cache`, `fun_outbox`,
`account_data_events`, sharing tables and `telemetry_samples`. It is **not** the authority for:

- identity, accounts, roles, sessions or the wallet — OpenVibe.Network;
- Live channels, Chat rooms/history, Today calendars — read-only upstreams or the person's own token;
- OSM/Ticketmaster data — cached, attributed public sources, never paid providers;
- event delivery (OpenVibe.Events), the host/database/Valkey (OpenVibe.Host), or the search index (OpenVibe.Search).

Public quests/plans are anonymized on account deletion; shared plans stay for their other members. Never silently keep
a deleted person's name on a row.

## Auth and Capabilities

- A person is the `fun_at` session cookie or `Authorization: Bearer <Network user token>`, verified offline. A
  cookie-authenticated write must come from `https://openvibe.fun` (403 `fun.cross_site`).
- Per-actor limits: `FUN_LIMITS_MINUTE`, `FUN_LIMITS_HOUR`; shared counters use Valkey.
- **Inbound v1: no service capability guards a route.** Do not invent one.
- **Outbound:** `events.subscription.manage` at boot; `network.account.export.contribute` and
  `network.account.deletion.confirm` through `openvibe-sdk/account-data`; `search.document.write` for the Search
  relay; `network.coins.credit` + `identity.subject.resolve` only when `FUN_COINS=on`.
- The OpenCoin credit is an outbox (`fun_quest_rewards`) with retries; the local badge is always paid.

## API (JSON under `/api/v1`)

`GET /guide`, `GET /quests`, `GET /quests/ideas`, `GET /quests/boards/:id`, `GET /quests/:slug`,
`POST /quests/boards`, `POST /quests/boards/:id/suggest|idea`, `POST /quests/:slug/vote|accept|live|complete|verify|hide|report`;
`GET /plans`, `GET /plans/:slug`, `POST /plans`, `POST /plans/:slug/options|vote|decide|today|hide|report`;
`GET /reports` (staff). Discovery/health: `/api/v1/ping`, `/openapi.json`, `/llms.txt`, `/sitemap.xml`, `/robots.txt`,
`/api/health`, `/api/ready`, `/release.json`, `/metrics` (loopback only). Errors are RFC 9457
`application/problem+json` with a stable `code` (`fun.invalid`, `fun.quest.*`, `fun.plan.*`, `fun.rate_limited`, …).

## Conventions

- CommonJS (`require`/`module.exports`), 4-space indent, single quotes, semicolons; no linter/formatter.
- Every route handler goes through [server/http/router.js](server/http/router.js) so async rejections reach the error
  handler. Never log request bodies; never return raw rows — page/view code renders explicit fields.
- IDs are `prefix_` + ULID via the store; timestamps are ISO strings from the injected clock.
- New schema = a new `migrations/NNNN_name.sql`; never edit a migration that has run. Keep table prefixes `fun_`.
- CSP: add every external origin to the `helmet` directives in [server/app.js](server/app.js); images/frames default
  to self plus the named OpenVibe hosts. Do not widen `frameAncestors` or `objectSrc`.
- Phone first: pages must work at 390 px with no horizontal overflow; the navbar/footer come from `openvibe-shared`.
- "Calm reduces, only Off removes": a user preference may de-emphasize content, never delete it; an Off switch is the
  only removal.
- Public pages must have real content in the first paint — no placeholder text or fake counts (`home-real-content`,
  `home-real-first` tests); link-outs must be real (`remind-links`).
- Do not add model calls or a new AI capability here: v1 is deterministic.

## Key Pitfalls

- **No build step.** Editing `public/` is live on deploy; do not add `?v=` by hand — the layout's asset version does
  that.
- **Upstreams are public and optional.** Ticketmaster is off without `TICKETMASTER_API_KEY`; OSM must be paced,
  cached, attributed (ODbL) and has a stale fallback. Never fetch an arbitrary user URL.
- **Read-only chat.** `server/chat-sync.js` ingests `!quest`/`!plan` commands idempotently per chat message id; it
  must never write to Chat or Live.
- **Drill mode.** Anything started at boot (timers, loops, outbound calls) must be off under `FUN_DRILL`.
- **Agent layer.** `.md` paths and `?format=markdown` are handled before page routes so `/q/x.md` is a twin, not a
  quest slug. New top-level page routes must also be visible to [server/http/pages.js](server/http/pages.js) and the
  sitemap/llms artifacts.
- **Safety filter.** `server/quests/safety.js` is explainable and must keep rejecting dangerous, illegal,
  trespassing and harassing suggestions before storage.
- **Account deletion** runs through `/internal/events` only (loopback, signature-verified); a redelivered event must
  change nothing.
- **No Font Awesome** in new UI unless the shared kit/glyph test for the page allows it; use the shared glyph set.

## Testing

`npm test` boots every `test/*.test.js` in its own process on a temporary PGlite database with a mock Network and
fixture upstreams (`test/run.js`). The suite covers migration, quest safety/state machine, chat idempotency, plan
voting/tie/Today, Search documents, SSO, cache/pages, coins opt-in off/on, sharing, account export/deletion, agent
layer, real-content-first and broken-link regressions. `npm run test:pg` runs the same suite through PostgreSQL +
PgBouncer. Run the narrowest file first (`npm test -- quests`), then the suite. Always `node --check` changed files.

## Documentation

- [README.md](README.md) — purpose, owns/does-not-own, capabilities, API, quest safety, guide, plans, pages, Search,
  run/test, deploy.
- [STATUS.json](STATUS.json) — current stage, deployed flag, features and not-yet list.
- [.env.example](.env.example) — every variable (names only; never commit values).
- [CHANGELOG.md](CHANGELOG.md) — released changes.
- [SECURITY.md](SECURITY.md) — vulnerability reporting.
