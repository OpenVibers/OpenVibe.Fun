# Security policy

OpenVibe is run in the open, and we want to hear about security problems before anyone else does.

## Reporting a vulnerability

Email **contact@openvibe.network** with "security" in the subject. Please include what you found, where (URL,
repository, file), how to reproduce it, and what an attacker could do with it. Do not open a public GitHub issue for
a vulnerability, and do not test against other people's accounts, data or streams.

We reply within 7 days, keep you updated while we fix it, and credit you when the fix ships if you would like.

## Scope

Every OpenVibe service and site (openvibe.fun, openvibe.live, openvibe.network, openvibe.today, openvibe.tools,
openvibe.media, openvibe.community, openvibe.games and the other openvibe.* domains) and every repository under
github.com/OpenVibers. Machine-readable contact details are at `/.well-known/security.txt` on each site.

## What OpenVibe.Fun holds

- Public quests and boards: the title, brief, category, place/city/point, accessibility mark, status, streamer
  username and reward id. A public quest is the community's record, not one person's private row.
- Public group plans: title, summary, city/point, time, timezone, options, public vote counts and the winner.
- A person's suggestions, votes, verification checks, badges, OpenCoin reward ledger, plans they started, plan
  options they proposed, plan votes and reports. These are exported and erased with an account; the public quest or
  shared plan stays with the author column set to NULL.
- A one-way key of the public chat username and the public message id for the read-only chat commands. A chat
  message's text is not stored, and Fun never posts a message. A chat vote is not linked to a Network subject, so
  it is not exportable by account, but it is also not stored as the plaintext username.
- Network session tokens only in httpOnly cookies (`fun_at`, `fun_rt`); no token is stored in the database,
  rendered into a page or logged. The Today call uses the person's own token and never stores it.
- OSM and Ticketmaster answers in `fun_geo_cache`: public place/event JSON, no person and no secret. The Ticketmaster
  key is a query parameter at the edge, never a cache key, a response field or a log line.

## Safety

Every suggestion and chat suggestion is checked against a small dangerous/illegal/trespassing/harassment/adult
filter before it is stored. A streamer can make a board accessible-only and cap suggestions. The chat verification
needs distinct public chat voters or a Network moderator. Any public quest or plan can be reported by a signed-in
person; staff can hide it. A hidden target answers 404 and writes a Search tombstone.

No Fun route needs a service token. A signed-in write from the session cookie must come from `openvibe.fun`
(Sec-Fetch-Site same-origin or an Origin equal to ours); anonymous and cross-site writes are refused. `/internal/events`
is loopback only and refuses a proxied request; nginx answers 404 for `/internal` and `/metrics`. The OBS overlay is
`noindex, nofollow` and has no script.

## Supported versions

Only the current `main` branch, which is what runs in production, receives fixes.
