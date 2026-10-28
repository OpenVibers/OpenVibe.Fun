'use strict';

/**
 * /api/v1 — OpenVibe.Fun's JSON API.
 *
 *   GET    /guide?q=&kind=&accessible=&rainy=&kids=&cheap=&lat=&lon=&radius=  OSM places + optional Ticketmaster
 *   GET    /quests?limit=&cursor=&status=&city=                              public IRL quests, newest first
 *   GET    /quests/ideas                                                     the safe starter deck
 *   GET    /quests/boards/:id                                                one board and its suggestions (share link)
 *   GET    /quests/:slug                                                     one quest, its votes and checks
 *   POST   /quests/boards                                                    a streamer opens a board (Live username checked)
 *   POST   /quests/boards/:id/suggest                                        a signed-in suggestion
 *   POST   /quests/boards/:id/idea                                           add one safe idea (owner/staff)
 *   POST   /quests/:slug/vote                                                one vote per person or chat username
 *   POST   /quests/:slug/accept|live|complete|verify                         the streamer (or staff) moves a quest on
 *   POST   /quests/:slug/hide                                                staff hides a public quest
 *   POST   /quests/:slug/report                                              a safety report
 *   GET    /plans?limit=&cursor=&city=                                       public group plans
 *   GET    /plans/:slug                                                      one plan, options and votes
 *   POST   /plans                                                            a signed-in person starts a plan
 *   POST   /plans/:slug/options|vote|decide|today                            add, vote, decide, add to Today
 *   POST   /plans/:slug/hide                                                 staff
 *   POST   /plans/:slug/report                                               a report
 *   GET    /reports                                                          staff: open reports
 *
 * Errors are application/problem+json with a `code`. A person is the fun_at session cookie or a Network user token
 * as a Bearer; a session write must come from openvibe.fun itself (403 fun.cross_site). No route needs a service
 * token. The one outbound service write (Today) uses the person's own token, never Fun's.
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { isStaff } = require('../identity/staff');
const ideas = require('../quests/ideas');
const { planEvent } = require('../today');

function createApi(ctx) {
    const { config, s, principal, store, guide, upstreams, coins } = ctx;
    const r = asyncRouter();

    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    // Per-actor limits on top of the per-address limit in server/app.js.
    const buckets = new Map();
    function windowCount(key, windowMs, limit) {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
        b.n += 1;
        return b.n <= limit;
    }
    r.use((req, res, next) => {
        if (req.principal && req.principal.kind === 'user' && req.principal.subject) {
            const who = `user:${req.principal.subject}`;
            if (!windowCount(`${who}:m`, 60_000, config.limits.minute) || !windowCount(`${who}:h`, 60 * 60_000, config.limits.hour)) {
                return problem(res, 429, 'fun.rate_limited', 'too many requests from this account; retry shortly');
            }
            if (buckets.size > 20_000) for (const [k, b] of buckets) if (Date.now() - b.start > 2 * 60 * 60_000) buckets.delete(k);
        }
        return next();
    });

    const problem = (res, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: res.req && res.req.ov });
    const invalid = (res, detail, field = null) => problem(res, 400, 'fun.invalid', field ? `${field}: ${detail}` : detail);
    const refuse = (res, out) => problem(res, out.status || 400, out.code || 'fun.invalid', out.message || 'invalid request');
    const asInt = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
    const bool = (v) => v === true || v === '1' || v === 'true' || v === 'yes' || v === 'on';

    function person(req, res) {
        const p = req.principal;
        if (p.kind === 'anonymous') { problem(res, 401, 'fun.sign_in_required', 'Sign in at openvibe.fun, or send a person\'s Network token as a Bearer.'); return null; }
        if (p.kind !== 'user') { problem(res, 403, 'fun.person_required', 'This route is for a person, not an app or service.'); return null; }
        if (p.viaSession && req.method !== 'GET' && !sameOrigin(req, config.baseUrl)) {
            problem(res, 403, 'fun.cross_site', 'A signed-in request that changes something must come from openvibe.fun itself.');
            return null;
        }
        return p;
    }
    const requirePerson = (req, res, next) => (person(req, res) ? next() : undefined);
    const requireStaff = (req, res, next) => {
        if (!person(req, res)) return undefined;
        if (!isStaff(req.principal)) return problem(res, 403, 'fun.staff_required', 'This route is for OpenVibe staff (Network role global_mod or above).');
        return next();
    };

    r.get('/ping', (_req, res) => res.json({ ok: true, service: config.service }));

    // ── Local guide ─────────────────────────────────────────
    r.get('/guide', async (req, res) => {
        const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : 'all';
        const lat = req.query.lat == null || req.query.lat === '' ? null : Number(req.query.lat);
        const lon = req.query.lon == null || req.query.lon === '' ? null : Number(req.query.lon);
        if ((lat != null && !Number.isFinite(lat)) || (lon != null && !Number.isFinite(lon))) return invalid(res, 'lat and lon must be numbers', 'lat');
        const radius = req.query.radius == null || req.query.radius === '' ? null : Number(req.query.radius);
        if (radius != null && (!Number.isFinite(radius) || radius <= 0)) return invalid(res, 'radius must be a positive number of kilometres', 'radius');
        try {
            const out = await guide.search({
                q: typeof req.query.q === 'string' ? req.query.q : null,
                lat, lon, radiusKm: radius, kind,
                accessible: bool(req.query.accessible), rainy: bool(req.query.rainy), kids: bool(req.query.kids), cheap: bool(req.query.cheap),
                limit: asInt(req.query.limit, config.osm.maxResults),
            });
            res.set('Cache-Control', 'public, max-age=300');
            return res.json(out);
        } catch (err) {
            if (err && err.code) return problem(res, err.status || 502, err.code, err.message || 'the guide could not answer');
            throw err;
        }
    });

    // ── Quests: public reads ────────────────────────────────
    r.get('/quests/ideas', (req, res) => {
        res.set('Cache-Control', 'public, max-age=300');
        return res.json({ count: ideas.IDEAS.length, ideas: ideas.IDEAS });
    });

    r.get('/quests/boards/:id', async (req, res) => {
        const out = await store.boardPage(String(req.params.id || ''));
        if (!out) return problem(res, 404, 'fun.board_not_found', 'No such quest board.');
        return res.json(out);
    });

    r.get('/quests', async (req, res) => {
        const limit = req.query.limit == null || req.query.limit === '' ? 20 : Number.parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) return invalid(res, 'limit must be from 1 to 50', 'limit');
        const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
        if (status && !store.PUBLIC_QUEST_STATUSES.includes(status)) return invalid(res, `status must be one of ${store.PUBLIC_QUEST_STATUSES.join(', ')}`, 'status');
        const out = await store.listQuests({
            limit, status, city: typeof req.query.city === 'string' && req.query.city ? req.query.city : null,
            cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
        });
        if (out.error === 'cursor') return invalid(res, 'cursor is not a cursor this API handed out', 'cursor');
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ count: out.quests.length, quests: out.quests, next_cursor: out.next_cursor });
    });

    r.get('/quests/:slug', async (req, res) => {
        const subject = req.principal.kind === 'user' ? req.principal.subject : null;
        const out = await store.questForPage(String(req.params.slug || ''), { subject, staff: isStaff(req.principal) });
        if (!out) return problem(res, 404, 'fun.quest_not_found', 'No such quest.');
        res.set('Cache-Control', out.quest.visibility === 'public' ? 'public, max-age=60' : 'private, no-store');
        return res.json(out);
    });

    // ── Quests: a streamer's board and suggestions ──────────
    r.post('/quests/boards', requirePerson, async (req, res) => {
        const p = req.principal;
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const liveUsername = String(b.live_username || p.username || '').trim();
        if (!liveUsername) return invalid(res, 'live_username is required', 'live_username');
        let channel;
        try { channel = await upstreams.liveChannel(liveUsername); } catch (err) { return problem(res, err.status || 502, err.code || 'fun.live.unavailable', err.message); }
        if (!channel.found) return problem(res, 404, 'fun.channel_not_found', 'No OpenVibe.Live channel has that username.');
        if (!p.username || String(p.username).toLowerCase() !== String(channel.username).toLowerCase()) {
            return problem(res, 403, 'fun.streamer_username', 'The signed-in Network username must match the Live channel it opens a board for.');
        }
        const out = await store.createBoard({
            streamerSubject: p.subject, title: b.title, liveUsername: channel.username, chatUsername: b.chat_username || channel.username,
            city: b.city, lat: b.lat, lon: b.lon, accessibleOnly: bool(b.accessible_only), maxSuggestions: b.max_suggestions, closesAt: b.closes_at,
        });
        if (!out.ok) return refuse(res, out);
        res.set('Location', `/api/v1/quests/boards/${out.board.id}`);
        return res.status(201).json(out.board);
    });

    r.post('/quests/boards/:id/suggest', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.createSuggestion({
            boardId: String(req.params.id || ''), subject: req.principal.subject,
            title: b.title, brief: b.brief, category: b.category, placeName: b.place_name,
            lat: b.lat, lon: b.lon, accessible: bool(b.accessible), source: 'suggestion',
        });
        if (!out.ok) return refuse(res, out);
        res.set('Location', `/api/v1/quests/${out.quest.slug}`);
        return res.status(201).json(out.quest);
    });

    r.post('/quests/boards/:id/idea', requirePerson, async (req, res) => {
        const boardId = String(req.params.id || '');
        const board = await store.boardById(boardId);
        if (!board) return problem(res, 404, 'fun.board_not_found', 'No such quest board.');
        if (!isStaff(req.principal) && board.streamer_subject !== req.principal.subject) return problem(res, 403, 'fun.streamer_required', 'Only the streamer whose board this is can add an idea.');
        const out0 = await store.boardPage(boardId);
        const remaining = ideas.forBoard({ accessibleOnly: Boolean(board.accessible_only), excludeTitles: (out0 ? out0.quests : []).map((q) => q.title) });
        const idea = remaining[0] || null;
        if (!idea) return problem(res, 409, 'fun.no_idea', 'There is no unused safe idea left for this board.');
        const out = await store.createSuggestion({
            boardId, subject: req.principal.subject, title: idea.title, brief: idea.brief, category: idea.category,
            accessible: Boolean(idea.accessible), source: 'idea',
        });
        if (!out.ok) return refuse(res, out);
        res.set('Location', `/api/v1/quests/${out.quest.slug}`);
        return res.status(201).json(out.quest);
    });

    // ── Quests: votes, acceptance, completion, verification ──
    r.post('/quests/:slug/vote', requirePerson, async (req, res) => {
        const out = await store.castQuestVote({ slug: String(req.params.slug || ''), subject: req.principal.subject, via: 'web' });
        if (!out.ok) return refuse(res, out);
        return res.json({ quest_id: out.quest_id, slug: out.slug, votes: out.votes });
    });

    r.post('/quests/:slug/accept', requirePerson, async (req, res) => {
        const out = await store.acceptQuest({ slug: String(req.params.slug || ''), subject: req.principal.subject, staff: isStaff(req.principal) });
        if (!out.ok) return refuse(res, out);
        return res.json(out.quest);
    });

    for (const to of ['live', 'completed']) {
        const path = to === 'live' ? '/quests/:slug/live' : '/quests/:slug/complete';
        r.post(path, requirePerson, async (req, res) => {
            const out = await store.setQuestStatus({ slug: String(req.params.slug || ''), subject: req.principal.subject, staff: isStaff(req.principal), to });
            if (!out.ok) return refuse(res, out);
            return res.json(out.quest);
        });
    }

    r.post('/quests/:slug/verify', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const via = b.via === 'moderator' ? 'moderator' : 'chat';
        const out = await store.verifyQuest({ slug: String(req.params.slug || ''), subject: req.principal.subject, staff: isStaff(req.principal), via });
        if (!out.ok) return refuse(res, out);
        let reward = out.reward || null;
        if (reward) reward = await coins.settle(reward, out.quest);
        return res.json({ ...out.quest, reward });
    });

    r.post('/quests/:slug/hide', requireStaff, async (req, res) => {
        const out = await store.hideQuest({ slug: String(req.params.slug || ''), staff: true });
        if (!out.ok) return refuse(res, out);
        return res.json(out.quest);
    });

    r.post('/quests/:slug/report', requirePerson, async (req, res) => {
        const quest = await store.byQuestSlug(String(req.params.slug || ''));
        if (!quest) return problem(res, 404, 'fun.quest_not_found', 'No such quest.');
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.createReport({ targetKind: 'quest', targetId: quest.id, subject: req.principal.subject, kind: b.kind || 'safety', reason: b.reason, note: b.note });
        if (!out.ok) return refuse(res, out);
        return res.status(201).json({ id: out.report.id, status: out.report.status, created_at: out.report.created_at });
    });

    // ── Group plans ─────────────────────────────────────────
    r.get('/plans', async (req, res) => {
        const limit = req.query.limit == null || req.query.limit === '' ? 20 : Number.parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) return invalid(res, 'limit must be from 1 to 50', 'limit');
        const out = await store.listPlans({
            limit, city: typeof req.query.city === 'string' && req.query.city ? req.query.city : null,
            cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
        });
        if (out.error === 'cursor') return invalid(res, 'cursor is not a cursor this API handed out', 'cursor');
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ count: out.plans.length, plans: out.plans, next_cursor: out.next_cursor });
    });

    r.get('/plans/:slug', async (req, res) => {
        const subject = req.principal.kind === 'user' ? req.principal.subject : null;
        const out = await store.planForPage(String(req.params.slug || ''), { subject, staff: isStaff(req.principal) });
        if (!out) return problem(res, 404, 'fun.plan_not_found', 'No such plan.');
        res.set('Cache-Control', out.plan.visibility === 'public' ? 'public, max-age=60' : 'private, no-store');
        return res.json(out);
    });

    r.post('/plans', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.createPlan({
            ownerSubject: req.principal.subject, ownerUsername: req.principal.username,
            title: b.title, summary: b.summary, city: b.city, lat: b.lat, lon: b.lon, timezone: b.timezone,
            startsAt: b.starts_at, closesAt: b.closes_at, visibility: b.visibility, chatUsername: b.chat_username,
            options: Array.isArray(b.options) ? b.options : [],
        });
        if (!out.ok) return refuse(res, out);
        res.set('Location', `/api/v1/plans/${out.plan.slug}`);
        return res.status(201).json(out.plan);
    });

    r.post('/plans/:slug/options', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.addPlanOption({
            slug: String(req.params.slug || ''), subject: req.principal.subject, staff: isStaff(req.principal),
            title: b.title, details: b.details, placeName: b.place_name, lat: b.lat, lon: b.lon,
            accessible: bool(b.accessible), priceNote: b.price_note, startsAt: b.starts_at,
        });
        if (!out.ok) return refuse(res, out);
        return res.status(201).json(out.option);
    });

    r.post('/plans/:slug/vote', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.castPlanVote({
            slug: String(req.params.slug || ''), subject: req.principal.subject,
            optionId: b.option_id ? String(b.option_id) : null, position: b.position == null ? null : b.position, via: 'web',
        });
        if (!out.ok) return refuse(res, out);
        return res.json({ plan_id: out.plan_id, option_id: out.option_id, position: out.position });
    });

    r.post('/plans/:slug/decide', requirePerson, async (req, res) => {
        const out = await store.decidePlan({ slug: String(req.params.slug || ''), subject: req.principal.subject, staff: isStaff(req.principal) });
        if (!out.ok) return refuse(res, out);
        return res.json(out.plan);
    });

    r.post('/plans/:slug/today', requirePerson, async (req, res) => {
        const out = await store.planForToday(String(req.params.slug || ''));
        if (!out) return problem(res, 404, 'fun.plan_not_found', 'No such plan.');
        if (out.error === 'not_decided') return problem(res, 409, 'fun.plan_not_decided', 'Decide the plan before adding it to Today.');
        if (!out.winner) return problem(res, 409, 'fun.plan_no_winner', 'This plan has no chosen option.');
        const plan = out.plan;
        if (new Date(plan.starts_at).getTime() < Date.now() + 5 * 60_000) return problem(res, 409, 'fun.plan_too_late', 'The plan starts too soon to add it to Today.');
        if (!req.principal.token) return problem(res, 401, 'fun.sign_in_required', 'A person\'s Network token is needed to add a plan to Today.');
        const body = planEvent(config, plan, out.winner);
        try {
            const created = await upstreams.todayCreate({ token: req.principal.token, body, idempotencyKey: `fun-plan-${plan.id}` });
            return res.status(201).json({ event_id: created.id, url: created.url });
        } catch (err) {
            return problem(res, err.status || 502, err.code || 'fun.today.unavailable', err.message);
        }
    });

    r.post('/plans/:slug/hide', requireStaff, async (req, res) => {
        const out = await store.hidePlan({ slug: String(req.params.slug || ''), staff: true });
        if (!out.ok) return refuse(res, out);
        return res.json(out.plan);
    });

    r.post('/plans/:slug/report', requirePerson, async (req, res) => {
        const plan = await store.planBySlug(String(req.params.slug || ''));
        if (!plan) return problem(res, 404, 'fun.plan_not_found', 'No such plan.');
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await store.createReport({ targetKind: 'plan', targetId: plan.id, subject: req.principal.subject, kind: b.kind || 'safety', reason: b.reason, note: b.note });
        if (!out.ok) return refuse(res, out);
        return res.status(201).json({ id: out.report.id, status: out.report.status, created_at: out.report.created_at });
    });

    r.get('/reports', requireStaff, async (req, res) => {
        const reports = await store.listOpenReports({ limit: asInt(req.query.limit, 100) });
        return res.json({ count: reports.length, reports });
    });

    return r;
}

module.exports = { createApi };
