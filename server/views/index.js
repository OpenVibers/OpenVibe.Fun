'use strict';

/**
 * The Fun room's pages (plan 2026-10-28 §5.10). Server-rendered and whole without JavaScript: every action is a
 * plain form or link. public/css/fun.css and public/js/fun.js are one-comment placeholders the main session
 * designs; the guide, the quest flow, the vote and the plan all work without them.
 *
 *   home({ counts, featured, plans })          the room, featured quests, plans and a guide teaser
 *   guide({ values, result, error })           the local guide form and its OSM/Ticketmaster answer
 *   quests({ quests, ideas })                  public IRL quests and the safe idea deck
 *   board({ board, quests, live, ... })        one streamer's suggestion board (share link)
 *   quest({ q, board, live, ... })             one quest, its votes/checks and the streamer's actions
 *   live({ boards, quests })                   the streamer's dashboard
 *   plans({ plans })                           public group plans
 *   plan({ p, options, winner, ... })          one plan, its options and votes
 *   planNew({ values })                        start a group plan
 *   developers(), signIn(), notFound(), overlay()
 * Each returns HTML for the page body; server/http/pages.js sends it through the layout. Ids and classes are stable
 * and start with `fu-`.
 */
const { esc } = require('../render/html');
const sc = require('openvibe-shared/showcase');

const STATUS_LABEL = { suggested: 'Suggested', accepted: 'Accepted', live: 'Live now', completed: 'Completed', verified: 'Verified', rejected: 'Not chosen', hidden: 'Hidden', voting: 'Voting', decided: 'Decided', cancelled: 'Cancelled' };
const CATEGORY_LABEL = { near_me: 'Near me', outside: 'Outside', brainy: 'Brainy', silly: 'Silly', chill: 'Chill' };
const KIND_LABEL = { all: 'Anything', outside: 'Outside', inside: 'Inside (rainy day)', arts: 'Arts', food: 'Food & drink' };

const statusBadge = (s) => `<span class="fu-status fu-status-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const categoryLabel = (c) => esc(CATEGORY_LABEL[c] || c || 'Near me');
const day = (iso) => (iso ? esc(String(iso).slice(0, 10)) : '—');
const when = (iso) => (iso ? esc(String(iso).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC')) : '—');
const pct = (n, total) => (total ? Math.round((Number(n) / Number(total)) * 100) : 0);
const safeHttp = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);

function empty(text, href = '/guide', label = 'Open the guide') {
    return `<div class="fu-empty"><p>${esc(text)}</p><a class="fu-btn fu-btn-quiet" href="${esc(href)}">${esc(label)}</a></div>`;
}

function questCard(q) {
    return `<li class="fu-quest-card" data-quest="${esc(q.slug)}">
<a class="fu-quest-link" href="/q/${esc(q.slug)}">
<span class="fu-quest-title">${esc(q.title)}</span>
<span class="fu-quest-meta">${statusBadge(q.status)} · ${categoryLabel(q.category)}${q.accessible ? ' · <span class="fu-accessible">Accessible</span>' : ''}</span>
<span class="fu-quest-facts">${q.votes == null ? '' : `<strong class="fu-votes">${Number(q.votes)}</strong> ${Number(q.votes) === 1 ? 'vote' : 'votes'} · `}${q.streamer_username ? `@${esc(q.streamer_username)} on Live` : ''}${q.city ? ` · ${esc(q.city)}` : ''}</span>
</a></li>`;
}

function planCard(p) {
    return `<li class="fu-plan-card" data-plan="${esc(p.slug)}">
<a class="fu-plan-link" href="/plans/${esc(p.slug)}">
<span class="fu-plan-title">${esc(p.title)}</span>
<span class="fu-plan-meta">${statusBadge(p.status)} · ${when(p.starts_at)}${p.city ? ` · ${esc(p.city)}` : ''}</span>
</a></li>`;
}

/** The home's picture: a small city block with idea pins and a quest card flipping up. */
function cityMotif() {
    return `<div class="fu-map-motif" aria-hidden="true">
<svg class="fu-map-lines" viewBox="0 0 420 280" preserveAspectRatio="none"><path d="M0 70 L420 96"/><path d="M0 180 L420 150"/><path d="M70 0 L110 280"/><path d="M250 0 L225 280"/><path d="M340 0 L370 280"/></svg>
<span class="fu-pin fu-pin-1">a bar</span><span class="fu-pin fu-pin-2">a mural</span><span class="fu-pin fu-pin-3">a bench</span><span class="fu-pin fu-pin-4">a gig</span>
<span class="fu-flip-card"><small>IRL quest</small><b>Get a stranger to beatbox</b><span>chat is voting</span></span>
</div>`;
}

function home({ counts = {}, featured = [], plans = [] } = {}) {
    const live = `<section class="fu-section" id="fu-featured" aria-labelledby="fu-featured-h">
<div class="fu-head-row"><h2 id="fu-featured-h">IRL quests on Live</h2><a class="fu-more" href="/quests">All quests</a></div>
${featured.length ? `<ol class="fu-quests">${featured.slice(0, 6).map(questCard).join('')}</ol>` : empty('No IRL quest is public yet. A streamer opens a board and chat suggests the first one.', '/live', 'Open a board on Live')}
</section>
<section class="fu-section" id="fu-plans" aria-labelledby="fu-plans-h">
<div class="fu-head-row"><h2 id="fu-plans-h">Plans, decided together</h2><a class="fu-more" href="/plans">All plans</a></div>
${plans.length ? `<ol class="fu-plans">${plans.slice(0, 4).map(planCard).join('')}</ol>` : empty('No group plan is public yet. Start one and send the link to the group.', '/plans/new', 'Start a plan')}
</section>
<section class="fu-section" id="fu-guide-teaser" aria-labelledby="fu-guide-teaser-h">
<div class="fu-head-row"><h2 id="fu-guide-teaser-h">What's fun near me?</h2><a class="fu-more" href="/guide">The local guide</a></div>
<p class="fu-lede">A city, a rainy afternoon or a cheap date: places from OpenStreetMap, local events from Ticketmaster when a key is configured, and a map link for every answer. No model call, no paid provider.</p>
</section>`;
    const room = sc.room({
        room: 'fun',
        hero: {
            title: 'Something to do, alone, together, or live',
            lede: 'IRL quests for streamers and their chat, a local guide that reads OpenStreetMap, and group plans where the vote picks the plan. Everything has a map, a time and a link — and it all works without JavaScript.',
            start: { href: '/guide', label: 'Find something near me' },
            chips: [{ label: 'IRL quests', href: '/quests' }, { label: 'Group plans', href: '/plans' }, { label: 'For streamers', href: '/live' }],
            proof: Number(counts.quests) || Number(counts.plans) ? [
                ...(Number(counts.quests) ? [{ value: Number(counts.quests), label: Number(counts.quests) === 1 ? 'public quest' : 'public quests' }] : []),
                ...(Number(counts.plans) ? [{ value: Number(counts.plans), label: Number(counts.plans) === 1 ? 'plan' : 'plans' }] : []),
            ] : [],
            motif: cityMotif(),
        },
        scenes: [
            { title: 'Chat suggests, you accept', text: 'A streamer opens a board for one session. Viewers suggest safe IRL challenges, chat votes with !quest vote, and the streamer accepts the one to do on stream.',
                html: `<div class="fu-demo-board"><span class="fu-status fu-status-accepted">Accepted</span><b>Find the best bench with a view</b><small>12 votes · @ada on Live</small></div>`,
                action: { href: '/live', label: 'Open a board' } },
            { title: 'A place becomes a plan', text: 'The guide shows what is open, what is free and what is step-free. One press turns a place into a group plan; the group votes and the winner goes to Today.',
                html: `<div class="fu-demo-plan"><span class="fu-pin fu-pin-static">a mural</span><span class="fu-arrow">→</span><span class="fu-status fu-status-decided">Decided</span><b>Saturday, 19:00</b></div>`,
                action: { href: '/guide', label: 'Ask the guide' } },
            { title: 'Verified, then paid', text: 'After the stream the quest is completed, verified by a moderator or enough chat checks, and the badge is paid. OpenCoins are loyalty points, never money, and only when the wallet is configured.',
                html: `<div class="fu-demo-verified"><span class="fu-status fu-status-verified">Verified</span><span class="fu-badge">IRL quest badge</span></div>`,
                action: { href: '/quests', label: 'See the quests' } },
        ],
        faq: { items: [
            ['Is this a social network?', 'No. Fun never posts to Chat or Live. It reads their public pages, and the only write to another service is a plan added to your own Today with your own Network token.'],
            ['Where does the guide get its places?', 'OpenStreetMap through Nominatim and Overpass, within both usage policies: a contact User-Agent, one request a second per host, a bounded around: query, and a seven-day cache. Every answer credits OSM (ODbL).'],
            ['Can a quest be dangerous?', 'No. Every suggestion is checked against a small dangerous/illegal/trespassing/harassment filter before it is stored, the streamer sets the limits, and any public quest can be reported to staff.'],
            ['What is paid on completion?', 'A free local badge, always. OpenCoins are loyalty points, never money; they are credited only when FUN_COINS is on and the Network grant exists, with per-person and network-wide daily caps.'],
        ] },
    });
    const at = room.indexOf('<section class="sc-room-scenes"');
    return `<div class="fu-wrap fu-home" id="fu-home">${at < 0 ? room : room.slice(0, at) + live + room.slice(at)}</div>`;
}

/** A small, tile-free map: the answer's pins on a grid, linked to the real map. No third-party tile requests. */
function miniMap(places, label = 'Map of the results') {
    const pts = (places || []).filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))).slice(0, 12);
    if (!pts.length) return '';
    const lats = pts.map((p) => Number(p.lat)); const lons = pts.map((p) => Number(p.lon));
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats); const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const x = (lon) => 20 + ((lon - minLon) / (maxLon - minLon || 1)) * 360;
    const y = (lat) => 20 + ((maxLat - lat) / (maxLat - minLat || 1)) * 140;
    return `<figure class="fu-map" id="fu-map"><svg viewBox="0 0 400 180" role="img" aria-label="${esc(label)}">
<rect x="0" y="0" width="400" height="180" rx="16" class="fu-map-bg"/>
<path d="M0 60 H400 M0 128 H400 M96 0 V180 M232 0 V180 M318 0 V180" class="fu-map-grid"/>
${pts.map((p, i) => `<g class="fu-map-pin"><circle cx="${x(Number(p.lon)).toFixed(1)}" cy="${y(Number(p.lat)).toFixed(1)}" r="7"/><text x="${x(Number(p.lon)).toFixed(1)}" y="${(y(Number(p.lat)) - 12).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`).join('')}
</svg><figcaption>${pts.length} ${pts.length === 1 ? 'pin' : 'pins'}, nearest first. <a href="https://www.openstreetmap.org/copyright" rel="noopener">© OpenStreetMap contributors</a> · <a href="${esc(pts[0].map_url || `https://www.openstreetmap.org/?mlat=${pts[0].lat}&mlon=${pts[0].lon}`)}" rel="noopener">Open the map</a></figcaption></figure>`;
}

function placeCard(p, i) {
    return `<li class="fu-place" data-place="${esc(p.id)}">
<div class="fu-place-body"><h3>${i + 1}. ${esc(p.name)}</h3>
<p class="fu-place-type">${esc(p.type_label || p.type)}${p.wheelchair === true ? ' · <span class="fu-accessible">Step-free</span>' : p.wheelchair === false ? ' · not step-free' : ''}${p.fee === false ? ' · free' : p.fee === true ? ' · has a fee' : ''}</p>
${p.address ? `<p class="fu-place-addr">${esc(p.address)}</p>` : ''}
<p class="fu-place-facts">${esc(String(p.distance_km))} km away${p.opening_hours ? ` · <span class="fu-hours">${esc(p.opening_hours)}</span>` : ''}</p>
<div class="fu-place-links">${p.website ? `<a href="${esc(safeHttp(p.website))}" rel="nofollow noopener">Website</a> · ` : ''}<a href="${esc(p.osm_url)}" rel="nofollow noopener">OpenStreetMap</a> · <a href="/plans/new?title=${encodeURIComponent(p.name)}&city=${encodeURIComponent(p.address || '')}&place=${encodeURIComponent(p.name)}&lat=${encodeURIComponent(p.lat)}&lon=${encodeURIComponent(p.lon)}">Make it a plan</a></div></div></li>`;
}

function eventCard(e) {
    return `<li class="fu-event" data-event="${esc(e.id)}">
<div class="fu-event-body"><h3>${esc(e.name)}</h3>
<p class="fu-event-meta">${when(e.starts_at)}${e.venue ? ` · ${esc(e.venue)}` : ''}${e.city ? ` · ${esc(e.city)}` : ''}</p>
${e.segment || e.genre ? `<p class="fu-event-type">${esc([e.segment, e.genre].filter(Boolean).join(' · '))}</p>` : ''}
<div class="fu-event-links">${e.url ? `<a href="${esc(safeHttp(e.url))}" rel="nofollow noopener">Tickets and details</a> · ` : ''}${e.map_url ? `<a href="${esc(e.map_url)}" rel="nofollow noopener">Map</a>` : ''}</div></div></li>`;
}

function guide({ values = {}, result = null, error = null } = {}) {
    const v = { q: '', kind: 'all', radius: '', accessible: false, rainy: false, kids: false, cheap: false, ...values };
    return `<div class="fu-wrap fu-guide-page" id="fu-guide">
<header class="fu-page-h"><p class="fu-kicker">The local guide</p><h1>What's fun near me?</h1>
<p class="fu-lede">A town, a rainy afternoon, a cheap date or a playground. The guide reads OpenStreetMap for places and Ticketmaster for events only when a key is configured. It is deterministic: no model call and no paid provider.</p></header>
<form id="fu-guide-form" class="fu-form fu-card" method="get" action="/guide">
<label class="fu-field"><span>Where?</span><input name="q" type="text" maxlength="200" value="${esc(v.q)}" placeholder="Portland, Oregon" required></label>
<label class="fu-field"><span>What kind?</span><select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${esc(k)}"${v.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
<label class="fu-field"><span>How far? (km)</span><input name="radius" type="number" min="1" max="50" step="1" value="${esc(v.radius)}" placeholder="5"></label>
<div class="fu-checks"><label><input type="checkbox" name="accessible" value="1"${v.accessible ? ' checked' : ''}> Step-free only</label><label><input type="checkbox" name="rainy" value="1"${v.rainy ? ' checked' : ''}> Rainy day (inside)</label><label><input type="checkbox" name="kids" value="1"${v.kids ? ' checked' : ''}> With kids</label><label><input type="checkbox" name="cheap" value="1"${v.cheap ? ' checked' : ''}> Free only</label></div>
<div class="fu-actions"><button class="fu-btn" type="submit">Find something</button></div>
<p class="fu-fine">Places © OpenStreetMap contributors, ODbL. Cached for seven days; one request a second to each OSM host.</p>
</form>
${error ? `<p class="fu-note is-bad" role="alert">${esc(error)}</p>` : ''}
${result ? `<section class="fu-section" id="fu-guide-results" aria-labelledby="fu-guide-results-h">
<div class="fu-head-row"><h2 id="fu-guide-results-h">${esc(result.location.display_name || result.location.name || 'Near you')}</h2><span class="fu-count">${result.results.length} ${result.results.length === 1 ? 'place' : 'places'}${result.cached ? ' · cached' : ''}</span></div>
${miniMap(result.results)}
${result.results.length ? `<ol class="fu-places" id="fu-guide-places">${result.results.map(placeCard).join('')}</ol>` : empty('Nothing matched those filters in this radius. Try a wider radius or another kind.', '/guide', 'Change the filters')}
<section class="fu-events-sec" id="fu-guide-events" aria-labelledby="fu-guide-events-h"><h2 id="fu-guide-events-h">Events</h2>
${result.events_configured ? (result.events.length ? `<ol class="fu-events">${result.events.map(eventCard).join('')}</ol>` : '<p class="fu-muted">Ticketmaster is configured but has no events in this radius in the next 30 days.</p>') : '<p class="fu-muted">Ticketmaster is not configured. The guide uses OpenStreetMap only; set <code>TICKETMASTER_API_KEY</code> to add events.</p>'}
${result.events_error ? `<p class="fu-fine">Event source unavailable just now: ${esc(result.events_error)}</p>` : ''}
</section>
<p class="fu-fine">© OpenStreetMap contributors · ODbL 1.0. ${result.events_configured ? 'Event data from Ticketmaster Discovery.' : ''}</p>
</section>` : ''}
</div>`;
}

function quests({ quests = [], ideas: ideaList = [] } = {}) {
    return `<div class="fu-wrap" id="fu-quests">
<header class="fu-page-h"><p class="fu-kicker">IRL quests on Live</p><h1>Challenges for the real world</h1>
<p class="fu-lede">Viewers suggest a safe challenge, chat votes with <code>!quest vote &lt;slug&gt;</code>, and the streamer accepts one on stream. Completion is checked by chat or a moderator, then the badge is paid. No challenge may be dangerous, illegal, trespassing or harassment.</p>
<div class="fu-actions"><a class="fu-btn" href="/live">Open a board on Live</a><a class="fu-btn fu-btn-quiet" href="/guide">Find a place first</a></div></header>
${quests.length ? `<ol class="fu-quests" id="fu-public-quests">${quests.map(questCard).join('')}</ol>` : empty('No IRL quest is public yet. The first one starts when a streamer opens a board.', '/live', 'Open a board')}
<section class="fu-section" id="fu-ideas" aria-labelledby="fu-ideas-h"><div class="fu-head-row"><h2 id="fu-ideas-h">The safe idea deck</h2><span class="fu-count">curated, not model output</span></div>
<ol class="fu-ideas">${ideaList.map((i) => `<li class="fu-idea"><b>${esc(i.title)}</b><span>${esc(i.brief)}</span><small>${categoryLabel(i.category)}${i.accessible ? ' · accessible' : ''}</small></li>`).join('')}</ol></section>
<section class="fu-section" id="fu-quest-safety" aria-labelledby="fu-quest-safety-h"><h2 id="fu-quest-safety-h">The rules</h2>
<ul class="fu-list"><li>No dangerous, illegal, trespassing or harassment challenges. The filter refuses them before they are stored.</li><li>The streamer sets the board's limits, including accessible-only when that is the promise.</li><li>A completed quest needs a chat quorum or a Network moderator before it is verified.</li><li>Anyone can report a public quest; staff can hide it.</li></ul></section>
</div>`;
}

function questNew({ values = {}, problem = null } = {}) {
    const v = values;
    return `<div class="fu-wrap fu-narrow" id="fu-quest-new">
<header class="fu-page-h"><p class="fu-kicker">For streamers</p><h1>Open a quest board</h1>
<p class="fu-lede">One board for one session. Your signed-in Network username must match the Live channel; Fun checks the public Live channel before it writes anything.</p></header>
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
<form id="fu-board-form" class="fu-form fu-card" method="post" action="/quests/boards">
<label class="fu-field"><span>Live channel</span><input name="live_username" type="text" maxlength="64" value="${esc(v.live_username || '')}" required placeholder="ada"></label>
<label class="fu-field"><span>Board title</span><input name="title" type="text" maxlength="120" value="${esc(v.title || '')}" required placeholder="Saturday IRL quests"></label>
<label class="fu-field"><span>City (optional)</span><input name="city" type="text" maxlength="120" value="${esc(v.city || '')}" placeholder="Portland, Oregon"></label>
<label class="fu-field"><span>Closes at (ISO time, optional)</span><input name="closes_at" type="text" maxlength="40" value="${esc(v.closes_at || '')}" placeholder="2026-10-28T22:00:00Z"></label>
<label class="fu-field"><span>Most suggestions</span><input name="max_suggestions" type="number" min="1" max="100" value="${esc(v.max_suggestions || 30)}"></label>
<label class="fu-check"><input type="checkbox" name="accessible_only" value="1"${v.accessible_only ? ' checked' : ''}> Only accessible activities</label>
<label class="fu-field"><span>Chat channel for votes</span><input name="chat_username" type="text" maxlength="64" value="${esc(v.chat_username || '')}" placeholder="defaults to the Live channel"></label>
<div class="fu-actions"><button class="fu-btn" type="submit">Open the board</button></div>
<p class="fu-fine">The board itself is unlisted; only the quest you accept becomes public.</p>
</form></div>`;
}

function board({ board: b, quests: list = [], live = null, signedIn = false, mine = false, staff = false, flash = null, problem = null } = {}) {
    return `<div class="fu-wrap" id="fu-board" data-board="${esc(b.id)}">
<header class="fu-page-h"><p class="fu-kicker">Quest board ${mine || staff ? '· yours' : ''}</p><h1>${esc(b.title)}</h1>
<p class="fu-lede">${esc(b.live_username)} on OpenVibe.Live${b.city ? ` · ${esc(b.city)}` : ''} · ${b.accessible_only ? 'accessible activities only · ' : ''}closes ${when(b.closes_at)}. ${live && live.found && live.live ? '<strong>Live now.</strong>' : ''}</p>
<div class="fu-actions"><a class="fu-btn" href="${esc(live && live.url ? live.url : `https://openvibe.live/@${encodeURIComponent(b.live_username)}`)}" rel="noopener">Watch @${esc(b.live_username)}</a>${mine || staff ? `<a class="fu-btn fu-btn-quiet" href="/live">Your boards</a>` : ''}</div></header>
${flash ? `<p class="fu-note" role="status">${esc(flash)}</p>` : ''}
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
${b.status === 'open' && signedIn ? `<section class="fu-section" id="fu-suggest" aria-labelledby="fu-suggest-h"><h2 id="fu-suggest-h">Suggest a challenge</h2>
<form id="fu-suggest-form" class="fu-form fu-card" method="post" action="/quests/boards/${esc(b.id)}/suggest">
<label class="fu-field"><span>The challenge</span><input name="title" type="text" maxlength="120" required placeholder="Find the best bench with a view"></label>
<label class="fu-field"><span>How it works (optional)</span><textarea name="brief" rows="2" maxlength="600"></textarea></label>
<label class="fu-field"><span>Kind</span><select name="category">${Object.entries(CATEGORY_LABEL).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></label>
<label class="fu-field"><span>A place (optional)</span><input name="place_name" type="text" maxlength="200"></label>
<label class="fu-check"><input type="checkbox" name="accessible" value="1"> This is accessible</label>
<div class="fu-actions"><button class="fu-btn" type="submit">Suggest it</button></div>
<p class="fu-fine">Checked against the safety filter before it is stored. No dangerous, illegal, trespassing or harassment challenges.</p>
</form></section>` : ''}
${mine || staff ? `<section class="fu-section" id="fu-deal"><form method="post" action="/quests/boards/${esc(b.id)}/idea" class="fu-inline"><button class="fu-btn fu-btn-quiet" type="submit">Deal a safe idea</button><span class="fu-fine">from the curated deck; no AI call</span></form></section>` : ''}
<section class="fu-section" id="fu-board-quests" aria-labelledby="fu-board-quests-h"><div class="fu-head-row"><h2 id="fu-board-quests-h">Suggestions</h2><span class="fu-count">${list.length} of ${b.max_suggestions}</span></div>
${list.length ? `<ol class="fu-quests">${list.map((q) => `<li class="fu-quest-card${q.status === 'accepted' ? ' is-accepted' : ''}" data-quest="${esc(q.slug)}">
<div class="fu-quest-body"><a class="fu-quest-title" href="/q/${esc(q.slug)}">${esc(q.title)}</a>
<span class="fu-quest-meta">${statusBadge(q.status)} · ${categoryLabel(q.category)} · <strong>${Number(q.votes) || 0}</strong> ${Number(q.votes) === 1 ? 'vote' : 'votes'}${q.accessible ? ' · accessible' : ''}</span>
${q.status === 'accepted' ? '<p class="fu-fine">This is the quest. It is public and on the Search feed.</p>' : ''}</div>
${signedIn && q.status === 'suggested' ? `<form method="post" action="/quests/${esc(q.slug)}/vote" class="fu-inline"><button class="fu-btn fu-btn-small" type="submit">Vote</button></form>` : ''}
${(mine || staff) && q.status === 'suggested' ? `<form method="post" action="/quests/${esc(q.slug)}/accept" class="fu-inline"><button class="fu-btn fu-btn-small fu-btn-quiet" type="submit">Accept this one</button></form>` : ''}
</li>`).join('')}</ol>` : empty('No suggestion yet. Share the board link and let chat start.', '#fu-suggest', 'Suggest one')}
</section>
<p class="fu-fine">Share this board: <code>${esc(b.id)}</code>. Chat commands: <code>!quest vote &lt;slug&gt;</code> and <code>!quest suggest &lt;text&gt;</code>. Fun reads public chat history; it never posts.</p>
</div>`;
}

function quest({ q, board: b, live = null, signedIn = false, voted = false, mine = false, staff = false, flash = null, problem = null, verifyVotes = 3 } = {}) {
    const owner = mine || staff;
    return `<div class="fu-wrap" id="fu-quest" data-quest="${esc(q.slug)}">
<article class="fu-quest-detail">
<header class="fu-page-h"><p class="fu-kicker">${categoryLabel(q.category)} · ${statusBadge(q.status)}${mine ? ' · your quest' : ''}</p><h1>${esc(q.title)}</h1>
<p class="fu-lede">${esc(q.brief)}</p>
<dl class="fu-facts"><div><dt>Votes</dt><dd><strong id="fu-quest-votes">${Number(q.votes) || 0}</strong></dd></div><div><dt>Verification checks</dt><dd id="fu-quest-checks">${Number(q.checks) || 0}</dd></div><div><dt>On Live</dt><dd>${q.streamer_username ? `<a href="${esc(q.stream_url)}" rel="noopener">@${esc(q.streamer_username)}</a>${live && live.live ? ' · live now' : ''}` : '—'}</dd></div><div><dt>Badge</dt><dd>${q.reward_badge ? esc(q.reward_badge) : 'paid on verification'}</dd></div></dl>
${q.place_name ? `<p class="fu-muted">Place: ${esc(q.place_name)}${q.city ? `, ${esc(q.city)}` : ''}${q.accessible ? ' · accessible' : ''}</p>` : ''}</header>
${flash ? `<p class="fu-note" role="status">${esc(flash)}</p>` : ''}
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
<section class="fu-section" id="fu-quest-actions" aria-labelledby="fu-quest-actions-h"><h2 id="fu-quest-actions-h">Take part</h2>
${q.status === 'verified' ? `<p class="fu-note" role="status">Verified. ${q.reward_badge ? 'The badge is paid.' : ''} ${Number(q.reward_coins) ? 'OpenCoins are recorded by the wallet when it is configured.' : ''}</p>` : ''}
${signedIn && q.status !== 'verified' ? `<form method="post" action="/q/${esc(q.slug)}/vote" class="fu-inline"><button class="fu-btn" type="submit"${voted ? ' disabled' : ''}>${voted ? 'You voted' : 'Vote for this quest'}</button></form>` : ''}
${!signedIn ? `<p class="fu-muted"><a href="/auth/login?next=${encodeURIComponent(`/q/${q.slug}`)}">Sign in</a> to vote.</p>` : ''}
${owner ? `<div class="fu-actions">
${q.status === 'suggested' && b && b.status === 'open' ? `<form method="post" action="/q/${esc(q.slug)}/accept" class="fu-inline"><button class="fu-btn" type="submit">Accept on stream</button></form>` : ''}
${q.status === 'accepted' ? `<form method="post" action="/q/${esc(q.slug)}/live" class="fu-inline"><button class="fu-btn" type="submit">Mark it live</button></form>` : ''}
${q.status === 'live' ? `<form method="post" action="/q/${esc(q.slug)}/complete" class="fu-inline"><button class="fu-btn" type="submit">Mark it completed</button></form>` : ''}
${q.status === 'completed' ? `<form method="post" action="/q/${esc(q.slug)}/verify" class="fu-inline"><input type="hidden" name="via" value="chat"><button class="fu-btn" type="submit">Verify with the chat quorum</button></form>${staff ? `<form method="post" action="/q/${esc(q.slug)}/verify" class="fu-inline"><input type="hidden" name="via" value="moderator"><button class="fu-btn fu-btn-quiet" type="submit">Verify as moderator</button></form>` : ''}` : ''}
</div>` : ''}
<p class="fu-fine">Chat: <code>!quest vote ${esc(q.slug)}</code> to vote, <code>!quest verify ${esc(q.slug)}</code> after completion. A verification needs ${esc(String(verifyVotes || 3))} distinct chat checks or a moderator.</p>
</section>
<section class="fu-section" id="fu-quest-report" aria-labelledby="fu-quest-report-h"><h2 id="fu-quest-report-h">Report a problem</h2>
${signedIn ? `<details class="fu-report"><summary>Report this quest</summary><form id="fu-report-form" class="fu-form" method="post" action="/q/${esc(q.slug)}/report">
<label class="fu-field"><span>Why?</span><select name="kind"><option value="safety">Unsafe</option><option value="spam">Spam</option><option value="other">Other</option></select></label>
<label class="fu-field"><span>What is wrong?</span><input name="reason" type="text" maxlength="2000" required></label>
<label class="fu-field"><span>Note (optional)</span><textarea name="note" rows="2" maxlength="4000"></textarea></label>
<button class="fu-btn fu-btn-quiet" type="submit">Send the report</button></form></details>` : `<p class="fu-muted"><a href="/auth/login?next=${encodeURIComponent(`/q/${q.slug}`)}">Sign in</a> to report.</p>`}
</section>
<footer class="fu-quest-foot"><a class="fu-btn fu-btn-quiet" href="/overlay/q/${esc(q.slug)}">Quest overlay for OBS</a><a class="fu-btn fu-btn-quiet" href="/quests">All quests</a>${staff ? `<form method="post" action="/q/${esc(q.slug)}/hide" class="fu-inline"><button class="fu-btn fu-btn-quiet" type="submit">Hide (staff)</button></form>` : ''}</footer>
</article></div>`;
}

function livePage({ boards = [], quests = [], signedIn = false, flash = null, problem = null } = {}) {
    return `<div class="fu-wrap" id="fu-live">
<header class="fu-page-h"><p class="fu-kicker">For streamers</p><h1>Put a quest on Live</h1>
<p class="fu-lede">Open one board for a session, let chat suggest and vote, accept the one you will do, then mark it live, completed and verified. Your Live channel is checked against the public channel before a board is written. Open the overlay as a browser source in OBS.</p>
<div class="fu-actions"><a class="fu-btn" href="/quests/new">Open a quest board</a><a class="fu-btn fu-btn-quiet" href="/quests">See public quests</a></div></header>
${flash ? `<p class="fu-note" role="status">${esc(flash)}</p>` : ''}
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
${!signedIn ? `<p class="fu-note">You can read this page without an account. <a href="/auth/login?next=%2Flive">Sign in</a> to open a board.</p>` : ''}
<section class="fu-section" id="fu-my-boards" aria-labelledby="fu-my-boards-h"><h2 id="fu-my-boards-h">Your boards</h2>
${boards.length ? `<ol class="fu-quests">${boards.map((b) => `<li class="fu-quest-card"><a class="fu-quest-link" href="/quests/boards/${esc(b.id)}"><span class="fu-quest-title">${esc(b.title)}</span><span class="fu-quest-meta">${statusBadge(b.status)} · @${esc(b.live_username)} · closes ${when(b.closes_at)}</span></a></li>`).join('')}</ol>` : empty(signedIn ? 'No board yet. Start one for your next IRL stream.' : 'Sign in to see your boards.', '/quests/new', 'Open a board')}
</section>
<section class="fu-section" id="fu-my-quests" aria-labelledby="fu-my-quests-h"><h2 id="fu-my-quests-h">Your latest quests</h2>
${quests.length ? `<ol class="fu-quests">${quests.map(questCard).join('')}</ol>` : '<p class="fu-muted">A quest appears here after you accept a suggestion or deal one from the safe deck.</p>'}
</section>
<section class="fu-section" id="fu-streamer-safety" aria-labelledby="fu-streamer-safety-h"><h2 id="fu-streamer-safety-h">Your limits</h2>
<p class="fu-fine">An accessible-only board refuses any suggestion not marked accessible. The safety filter is on every suggestion and chat command, before it is stored. You can hide a public quest only with staff; you can always close the board and stop taking suggestions.</p></section>
</div>`;
}

function planNew({ values = {}, problem = null } = {}) {
    const v = values;
    const opts = Array.from({ length: 3 }, (_, i) => v[`option${i + 1}_title`] || '');
    return `<div class="fu-wrap fu-narrow" id="fu-plan-new">
<header class="fu-page-h"><p class="fu-kicker">A group plan</p><h1>Pick a plan together</h1>
<p class="fu-lede">Add two or three things to do, send the link to the group, and let the votes choose. The winner can go to your own Today in one press; Fun never writes to anyone else's calendar.</p></header>
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
<form id="fu-plan-form" class="fu-form fu-card" method="post" action="/plans">
<label class="fu-field"><span>Plan title</span><input name="title" type="text" maxlength="120" value="${esc(v.title || '')}" required placeholder="Friday with the group"></label>
<label class="fu-field"><span>Why / notes (optional)</span><textarea name="summary" rows="2" maxlength="1200">${esc(v.summary || '')}</textarea></label>
<label class="fu-field"><span>City</span><input name="city" type="text" maxlength="120" value="${esc(v.city || '')}" placeholder="Portland, Oregon"></label>
<label class="fu-field"><span>Starts at (ISO time)</span><input name="starts_at" type="text" maxlength="40" value="${esc(v.starts_at || '')}" required placeholder="2026-10-30T19:00:00Z"></label>
<label class="fu-field"><span>Voting closes at (ISO time, optional)</span><input name="closes_at" type="text" maxlength="40" value="${esc(v.closes_at || '')}" placeholder="2026-10-29T19:00:00Z"></label>
<label class="fu-field"><span>Timezone</span><input name="timezone" type="text" maxlength="80" value="${esc(v.timezone || 'UTC')}" placeholder="America/Los_Angeles"></label>
<label class="fu-field"><span>Who can see it?</span><select name="visibility"><option value="unlisted"${v.visibility === 'unlisted' ? ' selected' : ''}>Anyone with the link</option><option value="public"${v.visibility === 'public' ? ' selected' : ''}>Public</option><option value="hidden"${v.visibility === 'hidden' ? ' selected' : ''}>Only me</option></select></label>
<label class="fu-field"><span>Chat channel for votes (optional)</span><input name="chat_username" type="text" maxlength="64" value="${esc(v.chat_username || '')}" placeholder="ada"></label>
<fieldset class="fu-options"><legend>Options</legend>
${opts.map((o, i) => `<label class="fu-field"><span>Option ${i + 1}${i === 0 ? '' : ' (optional)'}</span><input name="option${i + 1}_title" type="text" maxlength="120" value="${esc(o)}" placeholder="${i === 0 ? 'The mural walk' : ''}"></label>`).join('')}
</fieldset>
<div class="fu-actions"><button class="fu-btn" type="submit">Start the plan</button></div>
<p class="fu-fine">Times are UTC unless the timezone says otherwise. Voting closes one hour before the start when left blank.</p>
</form></div>`;
}

function plans({ plans: list = [] } = {}) {
    return `<div class="fu-wrap" id="fu-plans">
<header class="fu-page-h"><p class="fu-kicker">Group plans</p><h1>Decide it together</h1>
<p class="fu-lede">Two or three options, one link, one vote each. The winner is chosen by the group and can go to Today. A plan with votes from public chat shows the matching command.</p>
<div class="fu-actions"><a class="fu-btn" href="/plans/new">Start a plan</a><a class="fu-btn fu-btn-quiet" href="/guide">Find a place</a></div></header>
${list.length ? `<ol class="fu-plans" id="fu-public-plans">${list.map(planCard).join('')}</ol>` : empty('No public plan yet. Start one and share the link with the group.', '/plans/new', 'Start a plan')}
</div>`;
}

function plan({ p, options = [], winner = null, signedIn = false, mine = false, staff = false, flash = null, problem = null, myOptionId = null, totalVotes = 0 } = {}) {
    const owner = mine || staff;
    return `<div class="fu-wrap" id="fu-plan" data-plan="${esc(p.slug)}">
<article class="fu-plan-detail">
<header class="fu-page-h"><p class="fu-kicker">${statusBadge(p.status)} · ${p.visibility === 'public' ? 'public' : p.visibility === 'unlisted' ? 'share link' : 'private'}</p><h1>${esc(p.title)}</h1>
<p class="fu-lede">${p.summary ? esc(p.summary) : `A group plan${p.city ? ` in ${esc(p.city)}` : ''}.`}</p>
<dl class="fu-facts"><div><dt>Starts</dt><dd>${when(p.starts_at)}</dd></div><div><dt>Timezone</dt><dd>${esc(p.timezone)}</dd></div><div><dt>Votes</dt><dd id="fu-plan-total">${Number(totalVotes) || 0}</dd></div><div><dt>Voting closes</dt><dd>${when(p.closes_at)}</dd></div></dl></header>
${flash ? `<p class="fu-note" role="status">${esc(flash)}</p>` : ''}
${problem ? `<p class="fu-note is-bad" role="alert">${esc(problem)}</p>` : ''}
<section class="fu-section" id="fu-plan-options" aria-labelledby="fu-plan-options-h"><div class="fu-head-row"><h2 id="fu-plan-options-h">The options</h2><span class="fu-count">${options.length} ${options.length === 1 ? 'option' : 'options'}</span></div>
${options.length ? `<ol class="fu-options-list">${options.map((o) => `<li class="fu-option${o.id === (winner && winner.id) ? ' is-winner' : ''}${o.id === myOptionId ? ' is-mine' : ''}" data-option="${esc(o.id)}">
<div class="fu-option-body"><h3>${Number(o.position)}. ${esc(o.title)}${o.id === (winner && winner.id) ? ' <span class="fu-winner">chosen</span>' : ''}</h3>
${o.details ? `<p>${esc(o.details)}</p>` : ''}
<p class="fu-option-meta">${esc(String(o.votes || 0))} ${Number(o.votes) === 1 ? 'vote' : 'votes'} · ${pct(o.votes, totalVotes)}%${o.accessible ? ' · <span class="fu-accessible">Accessible</span>' : ''}${o.price_note ? ` · ${esc(o.price_note)}` : ''}${o.place_name ? ` · ${esc(o.place_name)}` : ''}</p>
<div class="fu-vote-bar" role="img" aria-label="${esc(String(o.votes || 0))} votes"><span style="width:${pct(o.votes, totalVotes)}%"></span></div></div>
${signedIn && p.status === 'voting' ? `<form method="post" action="/plans/${esc(p.slug)}/vote" class="fu-inline"><input type="hidden" name="option_id" value="${esc(o.id)}"><button class="fu-btn fu-btn-small" type="submit"${o.id === myOptionId ? ' disabled' : ''}>${o.id === myOptionId ? 'Your vote' : 'Vote'}</button></form>` : ''}
</li>`).join('')}</ol>` : empty('No option yet. The owner can add one.', `/plans/${esc(p.slug)}`, 'Back')}
${!signedIn ? `<p class="fu-muted"><a href="/auth/login?next=${encodeURIComponent(`/plans/${p.slug}`)}">Sign in</a> to vote.</p>` : ''}
${p.chat_username && p.status === 'voting' ? `<p class="fu-fine">Chat: <code>!plan vote ${esc(p.slug)} &lt;number&gt;</code>. Fun reads public chat history; it never posts.</p>` : ''}
</section>
<section class="fu-section" id="fu-plan-actions" aria-labelledby="fu-plan-actions-h"><h2 id="fu-plan-actions-h">Decide and go</h2>
${owner && p.status === 'voting' ? `<form method="post" action="/plans/${esc(p.slug)}/decide" class="fu-inline"><button class="fu-btn" type="submit">Decide the winner</button></form>` : ''}
${p.status === 'decided' && signedIn ? `<form method="post" action="/plans/${esc(p.slug)}/today" class="fu-inline"><button class="fu-btn" type="submit">Add the winner to my Today</button></form>` : ''}
${p.status === 'decided' && !signedIn ? `<p class="fu-muted"><a href="/auth/login?next=${encodeURIComponent(`/plans/${p.slug}`)}">Sign in</a> to add the winner to your Today.</p>` : ''}
${owner ? `<form method="post" action="/plans/${esc(p.slug)}/options" class="fu-form fu-card fu-add-option"><h3>Add an option</h3><label class="fu-field"><span>Title</span><input name="title" type="text" maxlength="120" required></label><label class="fu-field"><span>Place (optional)</span><input name="place_name" type="text" maxlength="200"></label><label class="fu-check"><input type="checkbox" name="accessible" value="1"> Accessible</label><button class="fu-btn fu-btn-quiet" type="submit">Add it</button></form>` : ''}
${owner && p.status === 'voting' ? `<p class="fu-fine">Add options before you decide. The vote is one per person or public chat username.</p>` : ''}
</section>
<section class="fu-section" id="fu-plan-report" aria-labelledby="fu-plan-report-h"><h2 id="fu-plan-report-h">Report</h2>
${signedIn ? `<details class="fu-report"><summary>Report this plan</summary><form id="fu-plan-report-form" class="fu-form" method="post" action="/plans/${esc(p.slug)}/report">
<label class="fu-field"><span>Why?</span><select name="kind"><option value="safety">Unsafe</option><option value="spam">Spam</option><option value="other">Other</option></select></label>
<label class="fu-field"><span>What is wrong?</span><input name="reason" type="text" maxlength="2000" required></label>
<button class="fu-btn fu-btn-quiet" type="submit">Send the report</button></form></details>` : `<p class="fu-muted"><a href="/auth/login?next=${encodeURIComponent(`/plans/${p.slug}`)}">Sign in</a> to report.</p>`}
${staff ? `<form method="post" action="/plans/${esc(p.slug)}/hide" class="fu-inline"><button class="fu-btn fu-btn-quiet" type="submit">Hide (staff)</button></form>` : ''}
</section>
<footer class="fu-plan-foot"><a class="fu-btn fu-btn-quiet" href="/plans">All plans</a><span class="fu-fine">Share link: ${esc(p.slug)}</span></footer>
</article></div>`;
}

function developers() {
    const ep = (m, p, d) => `<div><dt><code>${esc(m)} ${esc(p)}</code></dt><dd>${d}</dd></div>`;
    return `<div class="fu-wrap" id="fu-developers">
<header class="fu-page-h"><p class="fu-kicker">Developers</p><h1>The Fun API</h1>
<p class="fu-lede">JSON under <code>/api/v1</code>, with <code>application/problem+json</code> errors. A person is the <code>fun_at</code> session cookie or a Network user token as a Bearer. No route needs a service token; the one outbound write uses the person's own token.</p></header>
<section><h2>Local guide</h2><dl class="fu-eps">
${ep('GET', '/api/v1/guide?q=&kind=&accessible=&rainy=&kids=&cheap=&radius=', 'OSM places with attribution and a map link; Ticketmaster events only when a key is configured.')}
</dl></section>
<section><h2>IRL quests</h2><dl class="fu-eps">
${ep('GET', '/api/v1/quests?limit=&cursor=&status=&city=', 'Public IRL quests, newest first.')}
${ep('GET', '/api/v1/quests/:slug', 'One quest with its vote and chat-check counts.')}
${ep('GET', '/api/v1/quests/boards/:id', 'One board and its suggestions (the share link).')}
${ep('POST', '/api/v1/quests/boards', 'A streamer opens a board; the Live channel and Network username must match.')}
${ep('POST', '/api/v1/quests/boards/:id/suggest', '<code>{ title, brief?, category?, accessible? }</code>, safety-filtered.')}
${ep('POST', '/api/v1/quests/:slug/vote', 'One vote per person (or one per public chat username via the read-only chat job).')}
${ep('POST', '/api/v1/quests/:slug/accept|live|complete|verify', 'The streamer, or staff for verify; <code>{ via: "chat"|"moderator" }</code>.')}
${ep('POST', '/api/v1/quests/:slug/hide', 'Staff hides a public quest and tombstones its Search document.')}
</dl></section>
<section><h2>Group plans</h2><dl class="fu-eps">
${ep('GET', '/api/v1/plans?limit=&cursor=&city=', 'Public plans, newest first.')}
${ep('GET', '/api/v1/plans/:slug', 'One plan with options, vote counts and the winner.')}
${ep('POST', '/api/v1/plans', '<code>{ title, starts_at, timezone, options[] }</code>; the owner decides.')}
${ep('POST', '/api/v1/plans/:slug/options|vote|decide', 'Add an option, cast one vote, choose the winner (tie is refused).')}
${ep('POST', '/api/v1/plans/:slug/today', 'Adds the winner to the caller\'s own OpenVibe.Today with their token and an idempotency key.')}
${ep('POST', '/api/v1/plans/:slug/hide', 'Staff.')}
</dl></section>
<section id="fu-search"><h2>Search</h2><p class="fu-fine">Each public quest is one <code>search.index-document@1</code> (owner <code>fun</code>, type <code>quest</code>, <code>/q/&lt;slug&gt;</code>); each public plan is type <code>plan</code> (<code>/plans/&lt;slug&gt;</code>). They wait in <code>fun_outbox</code>; hiding or cancelling queues a tombstone. The relay needs the <code>search.document.write</code> grant and is not in v1.</p></section>
</div>`;
}

function signIn({ title, text, next }) {
    return `<div class="fu-wrap fu-page-pad fu-narrow"><div class="fu-empty"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="fu-btn" href="/auth/login?next=${encodeURIComponent(next)}">Sign in with OpenVibe</a></div></div>`;
}

function notFound() {
    return `<div class="fu-wrap fu-page-pad fu-narrow"><div class="fu-empty" id="fu-not-found"><p class="fu-kicker">404</p><h1>Nothing fun here</h1><p>This quest or plan may be hidden, its board may be closed, or the address was never one of ours.</p><a class="fu-btn" href="/">Back to Fun</a></div></div>`;
}

/** A minimal, no-JS OBS overlay: a meta refresh is the only moving part. */
function overlay({ q, votes = 0, live = null } = {}) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15"><meta name="robots" content="noindex,nofollow"><title>Quest overlay</title>
<link rel="stylesheet" href="/css/fun.css"></head><body class="fu-overlay-body">
<main class="fu-overlay" id="fu-overlay" data-quest="${esc(q.slug)}">
<p class="fu-overlay-kicker">IRL quest${live && live.live ? ' · live now' : ''}</p>
<h1 class="fu-overlay-title">${esc(q.title)}</h1>
<p class="fu-overlay-meta">${statusBadge(q.status)} · <strong>${Number(votes) || 0}</strong> ${Number(votes) === 1 ? 'vote' : 'votes'}</p>
${q.place_name ? `<p class="fu-overlay-place">${esc(q.place_name)}</p>` : ''}
<p class="fu-overlay-fine">Chat: <code>!quest vote ${esc(q.slug)}</code> · openvibe.fun/q/${esc(q.slug)}</p>
</main></body></html>`;
}

module.exports = {
    home, guide, quests, questNew, board, quest, livePage, plans, plan, planNew, developers, signIn, notFound, overlay,
    questCard, planCard, miniMap, placeCard, eventCard, statusBadge, categoryLabel, cityMotif,
    STATUS_LABEL, CATEGORY_LABEL, KIND_LABEL,
};
