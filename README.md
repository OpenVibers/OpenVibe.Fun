# OpenVibe.Fun

> Something to do, alone, together, or live.

**Status:** v1 written and tested (see [STATUS.json](STATUS.json)).
**Domain:** `openvibe.fun` · **Port:** 5140 · **Service id:** `fun` · **Env prefix:** `FUN`
**License:** AGPL-3.0-only (the same as every OpenVibe service).

OpenVibe.Fun is the Fun room. V1 has three things:

- **IRL quests on Live.** A streamer opens a board for their public Live channel. Viewers suggest safe real-world
  challenges, chat votes with `!quest vote <slug>`, the streamer accepts one on stream, marks it live and completed,
  and the chat or a moderator verifies it. A badge is paid locally; OpenCoins are loyalty points, never money, and
  only when the wallet is configured.
- **The local guide.** "What's fun near me?" — places from OpenStreetMap (Nominatim + Overpass), local events from
  Ticketmaster only when a key is configured, a tile-free map, times, links and an accessibility mark. It is
  deterministic in v1: no model call, no new AI capability, no paid provider.
- **Group plans.** Two or three options, one link, one vote each, a tie refused, the owner decides, and the winner
  can be added to the viewer's own Today with the viewer's own Network token.

**No social posting.** Fun reads OpenVibe.Chat's public history for votes and reads OpenVibe.Live's public channel
for the streamer/live state. It never posts a chat message, a stream announcement or a social entry. The one
external write is a plan added to *your own* Today.

## Owns

| Table | Holds | Migration |
|---|---|---|
| `fun_quest_boards` | `qbd_` + ULID, streamer subject (nullable after deletion), public Live/Chat username, title, city/point, accessible-only, max suggestions, status, accepted quest, window | `migrations/0001_initial.sql` |
| `fun_quests` | `qst_` + ULID, board, unique slug (`/q/<slug>`), title, brief, category, source, status `suggested\|accepted\|live\|completed\|verified\|rejected\|hidden`, visibility, place, accessible, streamer, revision, reward badge/coins, timestamps | `0001_initial.sql` |
| `fun_quest_votes` | one (`quest`, voter) row; voter is `usr_…` or `chat:<username>`; via web/chat, chat message id | `0001_initial.sql` |
| `fun_quest_checks` | one verification check per voter; chat or moderator, chat message id | `0001_initial.sql` |
| `fun_badges` | one local badge per (`quest`, subject) after verification | `0001_initial.sql` |
| `fun_quest_rewards` | `qrw_` + ULID, the OpenCoin ledger per quest/streamer: pending/credited/skipped/failed, attempts | `0001_initial.sql` |
| `fun_plans` | `pln_` + ULID, slug (`/plans/<slug>`), owner (nullable after deletion), title, city/point, timezone, start/close, status `voting\|decided\|cancelled`, winner, visibility, revision | `0001_initial.sql` |
| `fun_plan_options` | `pop_` + ULID, plan, title/details/place/point, accessible, price note, position 1–10 | `0001_initial.sql` |
| `fun_plan_votes` | one (`plan`, voter) row; option, via web/chat, chat message id | `0001_initial.sql` |
| `fun_reports` | `frp_` + ULID, quest/plan target, reporter, kind `safety\|spam\|other`, reason, status | `0001_initial.sql` |
| `fun_chat_seen`, `fun_chat_cursors` | the read-only chat page's idempotency and cursor | `0001_initial.sql` |
| `fun_geo_cache` | public OSM/Ticketmaster JSON, fetched/expires (never a person, never a secret) | `0001_initial.sql` |
| `fun_outbox` | Search Fabric documents/tombstones (Today/Meme shape) | `0001_initial.sql` |
| `account_data_events` | `openvibe-sdk/account-data` export/deletion receipts | `0001_initial.sql` |
| `telemetry_samples` | aggregated request telemetry, pruned after 14 days | `0001_initial.sql` |

## Does not own

- **Live, Chat and Today** — OpenVibe.Live, OpenVibe.Chat and OpenVibe.Today. Fun uses their public reads and, for
  Today, the person's own token on the public event API. It never posts to Live or Chat and never writes to anyone
  else's calendar.
- **Identity and roles** — OpenVibe.Network. Fun is OAuth client `fun` (PKCE S256) and verifies session tokens
  against the Network JWKS; staff means Network role `global_mod` or above.
- **OpenStreetMap and Ticketmaster** — external public sources, cached and credited; never a paid provider.
- **Search** — OpenVibe.Search receives `search.index-document@1` documents from `fun_outbox` when its writer is
  configured; the relay needs `search.document.write` and is not in v1.
- **Events, the host and the database** — OpenVibe.Events, OpenVibe.Host.

## Capabilities and grants

**Inbound, v1: none.** No Fun route requires a service, app or agent capability. A person is the `fun_at` session
cookie or a Network user token; a signed-in write from the cookie must come from `https://openvibe.fun`
(`fun.cross_site`).

**Outbound, v1:**

- `events.subscription.manage` — at boot, with `svc:fun`, to create the two account export/deletion subscriptions at
  OpenVibe.Events. The delivery itself is verified by the `FUN_EVENTS_SECRET` signature, not a token.
- `network.account.export.contribute` and `network.account.deletion.confirm` — the `createNetworkSender` calls that
  push the person's export part and the deletion confirmation to OpenVibe.Network's internal routes.
- `identity.subject.resolve` and `network.coins.credit` — **only when `FUN_COINS=on`**, with `svc:fun`, app id `fun`,
  to credit OpenCoins through OpenVibe.Network after a quest is verified. Off by default; the badge is still paid.

**Not needed in v1:** no Live, Chat, Today, Quest, Media or AI service token. The Today write uses the signed-in
person's own Network token, and the guide reads public OSM/Ticketmaster endpoints. A future Search relay needs
`search.document.write`; a future streamer-ownership proof could use a Live capability, but v1 checks the Network
username against the public Live channel.

## API

Everything is JSON under `/api/v1`; errors are `application/problem+json` with a `code`. A person is the `fun_at`
session cookie or `Authorization: Bearer <Network user token>`, verified offline with the Network JWKS. A write
made with the session cookie must come from `https://openvibe.fun` (403 `fun.cross_site`). A signed-in account also
gets per-actor minute/hour limits (`FUN_LIMITS_MINUTE`, `FUN_LIMITS_HOUR`).

| Route | What it does |
|---|---|
| `GET /guide?q=&kind=&accessible=&rainy=&kids=&cheap=&radius=&limit=` | OSM places with attribution/map links, plus Ticketmaster events only when configured; cached |
| `GET /quests?limit=&cursor=&status=&city=` | public IRL quests, newest first, opaque keyset cursor |
| `GET /quests/ideas` | the safe starter deck (curated in code, not model output) |
| `GET /quests/boards/:id` | one board and its suggestions (the share link; noindex) |
| `GET /quests/:slug` | one quest, its vote count, chat-check count and the viewer's vote |
| `POST /quests/boards` | a streamer opens a board; the Network username must match the public Live channel |
| `POST /quests/boards/:id/suggest` | a signed-in suggestion, safety-filtered before it is stored |
| `POST /quests/boards/:id/idea` | owner/staff adds one unused safe idea from the deck |
| `POST /quests/:slug/vote` | one vote per person; a repeat is idempotent |
| `POST /quests/:slug/accept\|live\|complete\|verify` | the streamer (or staff) moves the quest on; `verify` takes `{ via: "chat"\|"moderator" }` |
| `POST /quests/:slug/hide` | staff hides a public quest and writes a Search tombstone |
| `POST /quests/:slug/report` | signed-in safety/spam/other report |
| `GET /plans?limit=&cursor=&city=` | public group plans |
| `GET /plans/:slug` | one plan with options, vote counts and the winner |
| `POST /plans` | start a plan: title, start, timezone, 1–10 options |
| `POST /plans/:slug/options\|vote\|decide\|today` | add an option, cast one vote, choose the winner (tie refused), add the winner to your own Today |
| `POST /plans/:slug/hide` | staff hides a plan and writes a Search tombstone |
| `POST /plans/:slug/report` | signed-in report |
| `GET /reports` | staff: open reports |

Validation refusals are `400 { code: "fun.invalid" }` (or `fun.quest.invalid`, `fun.plan.invalid`,
`fun.report.invalid`). Other codes: `fun.sign_in_required`, `fun.person_required`, `fun.staff_required`,
`fun.streamer_required`, `fun.streamer_username`, `fun.cross_site`, `fun.not_found`, `fun.quest_not_found`,
`fun.plan_not_found`, `fun.board_not_found`, `fun.board_closed`, `fun.board_full`, `fun.quest_closed`,
`fun.quest_state`, `fun.quest_quorum`, `fun.plan_owner`, `fun.plan_closed`, `fun.plan_tie`,
`fun.plan_no_votes`, `fun.plan_not_decided`, `fun.rate_limited`, `fun.guide.invalid`, `fun.guide.not_found`,
`fun.guide.upstream`, `fun.channel_not_found`, `fun.live.unavailable`, `fun.today.*`.

## IRL quests and safety

The state machine is `suggested → accepted → live → completed → verified`, with `rejected` for the suggestions the
streamer did not choose and `hidden` for a staff takedown. Before any suggestion is stored, `server/quests/safety.js`
checks it against a small, explainable list of dangerous, illegal, trespassing, harassment and adult patterns. The
plan's own playful example ("get a stranger to beatbox") is allowed; "climb a bridge and jump off" is not. The
streamer can make a board accessible-only and cap the number of suggestions. The public page carries a report form;
staff see the open reports and can hide the quest.

Chat voting is read-only. A timer reads one page of the public `GET /api/chat/global/history?username=<channel>` and
applies at most one command per message id (`fun_chat_seen`):

- `!quest vote <slug>`
- `!quest suggest <text>` (safety-filtered; stored unlisted)
- `!quest verify <slug>` (after the streamer marks it completed)
- `!plan vote <slug> <number>`

No message text beyond a bounded command, no account and no token is stored; a chat voter is a one-way key of the public username, not a copy of it. A re-read of the same public page
changes nothing. Under `FUN_DRILL` the timer is not started; tests call `runOnce()`.

Verification by `via: "chat"` needs `FUN_QUEST_VERIFY_VOTES` distinct chat checks (default 3); a Network moderator
can verify directly with `via: "moderator"`. Verification always writes a local `fun_badges` row; it writes a
`fun_quest_rewards` row for OpenCoins and settles it through the optional wallet adapter.

## The local guide

`server/guide/upstream.js` is the only outbound host list: Nominatim, Overpass and Ticketmaster. It follows their
usage policies:

- **Identify:** every request carries `FUN_OSM_USER_AGENT` (an `OpenVibeFun/0.1 (+https://openvibe.fun; …)` contact
  string). A browser User-Agent is never used.
- **Pace:** `createPacer` serialises calls per host, at least `FUN_OSM_MIN_INTERVAL_MS` (1000 ms) apart; Ticketmaster
  has its own interval.
- **Cache:** every answer is in `fun_geo_cache` for `FUN_GEO_CACHE_TTL_MS` (7 days OSM, 15 minutes Ticketmaster); the
  last answer is served stale if the host is down.
- **Bound:** one `around:<radius>,<lat>,<lon>` query with a small set of tags, `out center tags`, never a bulk
  download. The radius is capped by `FUN_GUIDE_MAX_RADIUS_KM`.
- **Credit:** every API answer and page shows © OpenStreetMap contributors, ODbL 1.0, and links back.

Ticketmaster is **off by default**. It is read only when `TICKETMASTER_API_KEY` is set; the key is a query parameter
at the edge, is never in the cache key, is never returned and is never logged. Events show name, venue, local times
and a public link; Fun never sells a ticket, takes a payment or calls a paid provider.

The guide is deterministic: `kind` (`all`, `outside`, `inside`, `arts`, `food`) plus `accessible`, `rainy`, `kids`
and `cheap` filter the same OSM answer. There is no model call and no new AI capability.

## Group plans and Today

A plan has 1–10 options and one vote per person (or public chat username); a vote can change until `closes_at`.
The owner or staff decides; a tie is `409 fun.plan_tie`. A decided plan's winner can be added to the viewer's own
Today: `POST /plans/:slug/today` calls Today's public `POST /api/v1/events` with the viewer's Network token and
`Idempotency-Key: fun-plan-<plan id>`. Fun never fans out to other people's calendars; each person adds it to
their own Today. A hidden plan is 404 to the public.

## Pages

All server-rendered through the OpenVibe Frame (`openvibe-shared/shell`), readable without JavaScript, with
semantic HTML and stable `fu-` ids/classes. Public pages are `public, max-age=60` with `Vary: Cookie`; a page drawn
for a signed-in person is `private, no-store`; a board share page is `no-store`.

| Page | What it is |
|---|---|
| `/` | the room, featured quests, plans, the guide teaser |
| `/guide` | the guide form and its OSM/Ticketmaster answer |
| `/quests` | public IRL quests and the safe idea deck |
| `/quests/new` | open a board (streamer) |
| `/quests/boards/:id` | one board, suggestions, vote and accept forms |
| `/q/:slug` | one quest, votes/checks, streamer actions, report form |
| `/live` | a streamer's boards and quests |
| `/plans`, `/plans/new` | public plans and the form |
| `/plans/:slug` | options, votes, decide, add to Today |
| `/developers` | the API and Search document |
| `/overlay/q/:slug` | a minimal OBS browser source, meta-refresh, noindex |
| 404 | the not-found page |

`public/css/fun.css` and `public/js/fun.js` are one-comment placeholder files: the pages are complete without them
and the main session designs them. `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt` list the public pages
and every public quest/plan.

## Search

Each public quest is one `search.index-document@1` (owner `fun`, type `quest`, page `/q/<slug>`); each public plan is
type `plan` (`/plans/<slug>`). The document carries the public title/brief/body, facets (`status`, `category`,
`city`, `accessible`, `streamer`, `source`), human authorship and a Live channel provenance reference for a quest.
Publishing, accepting, moving or deciding writes/updates the document in the same transaction; hiding or
cancelling writes a tombstone. Rows live in `fun_outbox`; the relay is deliberately not in v1 and needs the
`search.document.write` grant.

## The first proof (covered by the tests)

`test/chat-sync.test.js` and `test/quests.test.js` cover the plan's first proof end to end: a chat message suggests
a quest, a public chat vote counts, the streamer accepts it on their board, marks it live and completed, three
distinct chat checks (or a moderator) verify it, and a badge is paid. `test/plans.test.js` covers the second proof:
a group votes, the winner is decided and goes to the viewer's own Today.

## Run and test

```sh
npm install
npm test                 # PGlite; every test file in its own process, no network needed
npm run test:pg          # the same through PostgreSQL + PgBouncer (openvibe-sdk scripts/test-services.sh up)
OV_ALLOW_SUITE=1 npm test
npm start                # PORT 5140, loopback; DATABASE_URL or an embedded PGlite in development
```

The tests boot the app with a mock Network, a Live/Chat/Today/OSM/Ticketmaster fixture server, and a temporary
database: the migration, the guide's cache/pacer/User-Agent and Ticketmaster off-by-default, quest safety and the
full state machine, chat suggestion/vote/verify idempotency, plan voting/tie/Today, Search document validation,
SSO, pages/cache, coins opt-in, and account export/deletion.

## Deploy

`deploy/systemd/openvibe-fun.service` (127.0.0.1:5140, `/etc/openvibe/fun.env`) and
`deploy/nginx/openvibe.fun.conf` (TLS, www → apex, `/auth/me` on the API zone, a forms zone for the POST routes,
`/internal` and `/metrics` 404). Not deployed by this change.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.236.0
- openvibe-sdk: v0.70.0
- openvibe-shared: v4.36.2
<!-- versions:end -->
