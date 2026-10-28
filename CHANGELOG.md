# Changelog

What changed in OpenVibe.Fun, newest first.

## 0.1.0 — 2026-10-28

The first version: IRL quests on Live, the local guide and group plans.

- **IRL quests on Live.** `fun_quest_boards` is a streamer's board for one session, checked against the public
  OpenVibe.Live channel and the signed-in Network username. `fun_quests` is suggested → accepted → live → completed
  → verified, with `rejected` and `hidden`. Suggestions pass an explainable dangerous/illegal/trespassing/
  harassment filter before they are stored; a board can be accessible-only and has a suggestion cap. One vote per
  person per quest.
- **Verification and reward.** A completed quest is verified by `FUN_QUEST_VERIFY_VOTES` distinct public chat checks
  or by a Network moderator (`global_mod`+). A local `fun_badges` row is always paid; `fun_quest_rewards` records the
  OpenCoins ledger. OpenCoins are loyalty points, never money, and are credited only with `FUN_COINS=on` through
  Network's `identity.subject.resolve` + `network.coins.credit` with the reward id as the idempotency key.
- **Chat is read, never posted.** A timer reads one public page of the channel's `GET /api/chat/global/history` and
  applies `!quest vote`, `!quest suggest`, `!quest verify` and `!plan vote` at most once per message id. Deleted or
  unsafe messages are skipped. Under `FUN_DRILL` the timer is off; tests call `runOnce()`.
- **The local guide.** `fun_geo_cache` stores OSM/Ticketmaster JSON. Nominatim and Overpass requests carry
  `FUN_OSM_USER_AGENT`, are paced per host (1/s by default), cached seven days with stale fallback and are bounded to
  one around: radius. Places show distance, address, opening hours, accessibility, a tile-free map and ODbL
  attribution. Ticketmaster Discovery is off unless `TICKETMASTER_API_KEY` is set; the key is never cached, returned
  or logged. No model call, no AI capability, no paid provider.
- **Group plans.** `fun_plans` + `fun_plan_options` + `fun_plan_votes`: one vote per person or public chat username,
  changing allowed until close, a tie refused, owner/staff decides, and the winner goes to the caller's own
  OpenVibe.Today through Today's public event API with the caller's token and `Idempotency-Key: fun-plan-<id>`.
- **Safety and moderation.** `fun_reports` collects signed-in safety/spam/other reports; staff list them and can hide
  a public quest or plan. Hiding writes a Search tombstone.
- **Search.** Each public quest/plan is one `search.index-document@1` in `fun_outbox` (owner `fun`, types `quest`
  and `plan`), with a revision, public URL and public body. The relay waits for the `search.document.write` grant.
- **The service.** Network SSO as OAuth client `fun` (PKCE S256, `fun_at`/`fun_rt`/`fun_oauth`), truthful readiness,
  Prometheus metrics on loopback, discovery, deploy files, and server-rendered pages with stable `fu-` ids plus a
  no-JS OBS overlay. `public/css/fun.css` and `public/js/fun.js` are one-comment placeholders for the main session.
- **Account data.** Export covers boards, suggestions, votes, checks, badges, rewards, plans, options, plan votes and
  reports. Deletion erases personal rows and anonymizes the community record (subject NULL); another person's rows
  and public titles stay.
- **Tests.** Migration, guide/cache/pacer/Ticketmaster, quest safety and state machine, chat idempotency, plans and
  Today, Search document validation, SSO, pages/cache, coins opt-in and account export/deletion, each in its own
  process on a temporary PGlite database with a mock Network and upstream fixtures.
