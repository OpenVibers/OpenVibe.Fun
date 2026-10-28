'use strict';

/**
 * Fun's server-rendered pages. They work without JavaScript: forms are plain POSTs and every link is a real link.
 * Public pages are served `public, max-age=60` with Vary: Cookie; a page drawn for a signed-in person is
 * `private, no-store`. The overlay is the one page that is not the Frame: an OBS browser source, noindex, refreshed
 * by a meta tag so it works with JavaScript off.
 *
 *   /                     the room, featured quests, plans and the guide teaser
 *   /guide                the local guide form and its OSM/Ticketmaster answer
 *   /quests               public IRL quests and the safe idea deck
 *   /quests/new           open a board (a streamer; the Live channel is checked)
 *   /quests/boards/:id    one board, its suggestions and the vote/accept forms
 *   /q/:slug              one quest, its votes/checks, the streamer actions and the report form
 *   /live                 a streamer's boards and quests
 *   /plans, /plans/new    group plans and the form
 *   /plans/:slug          one plan: options, votes, decide and add-to-Today
 *   /developers, 404, /overlay/q/:slug
 */
const express = require('express');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { sameOrigin } = require('./principal');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { isStaff } = require('../identity/staff');
const { planEvent } = require('../today');
const ideas = require('../quests/ideas');
const views = require('../views');

const PUBLIC_CACHE = 'public, max-age=60';

function createPageRoutes(ctx) {
    const { config, s, store, upstreams, guide, coins } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.subject;
    const staffViewer = (req) => isStaff(req.viewer);
    const signInPrompt = (what, next) => `<div class="notice">${what} <a href="/auth/login?next=${encodeURIComponent(next)}">Sign in with OpenVibe</a>.</div>`;
    const notFromHere = (req, res) => page(req, res, {
        title: 'Not from this site',
        body: raw('<div class="fu-wrap fu-page-pad fu-narrow"><div class="fu-empty"><h1>That came from somewhere else</h1><p class="fu-muted">Use the form on <a href="/">OpenVibe.Fun</a>.</p></div></div>'),
    }, 403);
    const guard = (req, res, next) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(req.originalUrl.split('?')[0])}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        return next();
    };
    const formValues = (body, fields) => Object.fromEntries(fields.map((f) => [f, body && body[f] != null ? String(body[f]) : '']));

    async function liveOf(username) {
        try { return await upstreams.liveChannel(username); } catch { return null; }
    }

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const [counts, featured, planOut] = await Promise.all([store.counts(), store.featuredQuests(6), store.listPlans({ limit: 4 })]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE,
            title: null,
            description: 'Something to do, alone, together, or live: IRL quests on OpenVibe.Live, a local guide from OpenStreetMap, and group plans that the group votes on.',
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ counts, featured, plans: planOut.plans })),
        });
    });

    // ── The local guide ─────────────────────────────────────
    r.get('/guide', async (req, res) => {
        const values = {
            q: typeof req.query.q === 'string' ? req.query.q : '',
            kind: typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : 'all',
            radius: typeof req.query.radius === 'string' ? req.query.radius : '',
            accessible: req.query.accessible === '1', rainy: req.query.rainy === '1',
            kids: req.query.kids === '1', cheap: req.query.cheap === '1',
        };
        let result = null; let problem = null; let status = 200;
        if (values.q.trim()) {
            try {
                result = await guide.search({
                    q: values.q, kind: values.kind, radiusKm: values.radius ? Number(values.radius) : null,
                    accessible: values.accessible, rainy: values.rainy, kids: values.kids, cheap: values.cheap,
                });
            } catch (err) {
                problem = (err && err.message) || 'The guide could not answer just now.';
                status = (err && err.status) || 502;
            }
        }
        return page(req, res, {
            index: true, cache: result ? PUBLIC_CACHE : null,
            title: 'The local guide',
            description: 'What\'s fun near me? Places from OpenStreetMap and local events from Ticketmaster when a key is configured, with a map, times and links.',
            jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Fun local guide', url: `${base()}/guide`, description: 'Places from OpenStreetMap, local events when Ticketmaster is configured.', siteUrl: base() })],
            body: raw(views.guide({ values, result, error: problem })),
        }, status);
    });

    // ── IRL quests ──────────────────────────────────────────
    r.get('/quests', async (req, res) => {
        const out = await store.listQuests({ limit: 30 });
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE,
            title: 'IRL quests on Live',
            description: 'Viewers suggest, chat votes, the streamer accepts and a moderator or the chat verifies. Safe, accessible challenges for the real world.',
            jsonLd: [seo.jsonLd.webPage({ name: 'IRL quests on OpenVibe.Live', url: `${base()}/quests`, description: 'Safe IRL challenges for streamers and their chat.', siteUrl: base() })],
            body: raw(views.quests({ quests: out.quests, ideas: ideas.IDEAS })),
        });
    });
    r.get('/quests/ideas', (req, res) => res.redirect(303, '/quests#fu-ideas'));

    r.get('/quests/new', (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Open a quest board', body: raw(views.signIn({ title: 'Open a quest board', text: 'A board belongs to the streamer whose Live channel it is.', next: '/quests/new' })) }, 401);
        return page(req, res, {
            index: false, title: 'Open a quest board',
            body: raw(views.questNew({ values: { live_username: req.viewer.username || '' } })),
        });
    });

    r.post('/quests/boards', guard, async (req, res) => {
        const b = req.body || {};
        const liveUsername = String(b.live_username || req.viewer.username || '').trim();
        let channel;
        try { channel = await upstreams.liveChannel(liveUsername); } catch (err) {
            return page(req, res, { title: 'Open a quest board', body: raw(views.questNew({ values: formValues(b, ['live_username', 'title', 'city', 'closes_at', 'max_suggestions', 'chat_username']), problem: err.message })) }, err.status || 502);
        }
        if (!channel.found) return page(req, res, { title: 'Open a quest board', body: raw(views.questNew({ values: formValues(b, ['live_username', 'title', 'city', 'closes_at', 'max_suggestions', 'chat_username']), problem: 'No OpenVibe.Live channel has that username.' })) }, 404);
        if (!req.viewer.username || String(req.viewer.username).toLowerCase() !== String(channel.username).toLowerCase()) {
            return page(req, res, { title: 'Open a quest board', body: raw(views.questNew({ values: formValues(b, ['live_username', 'title', 'city', 'closes_at', 'max_suggestions', 'chat_username']), problem: 'The signed-in Network username must match the Live channel.' })) }, 403);
        }
        const out = await store.createBoard({
            streamerSubject: req.viewer.subject, title: b.title, liveUsername: channel.username, chatUsername: b.chat_username || channel.username,
            city: b.city, accessibleOnly: b.accessible_only === '1', maxSuggestions: b.max_suggestions, closesAt: b.closes_at,
        });
        if (!out.ok) return page(req, res, { title: 'Open a quest board', body: raw(views.questNew({ values: formValues(b, ['live_username', 'title', 'city', 'closes_at', 'max_suggestions', 'chat_username']), problem: out.message })) }, out.status || 400);
        return res.redirect(303, `/quests/boards/${encodeURIComponent(out.board.id)}`);
    });

    r.get('/quests/boards/:id', async (req, res) => {
        const out = await store.boardPage(String(req.params.id || ''));
        if (!out) return notFound(req, res);
        const rawBoard = await store.boardById(String(req.params.id || ''));
        const mine = Boolean(signedIn(req) && rawBoard && rawBoard.streamer_subject === req.viewer.subject);
        const live = await liveOf(out.board.live_username);
        return page(req, res, {
            index: false, title: out.board.title,
            body: raw(views.board({ board: out.board, quests: out.quests, live, signedIn: Boolean(signedIn(req)), mine, staff: staffViewer(req), flash: req.query.saved === '1' ? 'Saved.' : null })),
        });
    });

    r.post('/quests/boards/:id/suggest', guard, async (req, res) => {
        const b = req.body || {};
        const out = await store.createSuggestion({
            boardId: String(req.params.id || ''), subject: req.viewer.subject,
            title: b.title, brief: b.brief, category: b.category, placeName: b.place_name,
            accessible: b.accessible === '1', source: 'suggestion',
        });
        if (!out.ok) {
            const pageOut = await store.boardPage(String(req.params.id || ''));
            if (!pageOut) return notFound(req, res);
            const rawBoard = await store.boardById(String(req.params.id || ''));
            return page(req, res, {
                index: false, title: 'Suggest a challenge',
                body: raw(views.board({ board: pageOut.board, quests: pageOut.quests, live: await liveOf(pageOut.board.live_username), signedIn: true, mine: Boolean(rawBoard && rawBoard.streamer_subject === req.viewer.subject), staff: staffViewer(req), problem: out.message })),
            }, out.status || 400);
        }
        return res.redirect(303, `/quests/boards/${encodeURIComponent(out.quest.board_id)}?saved=1`);
    });

    r.post('/quests/boards/:id/idea', guard, async (req, res) => {
        const id = String(req.params.id || '');
        const rawBoard = await store.boardById(id);
        if (!rawBoard) return notFound(req, res);
        if (!staffViewer(req) && rawBoard.streamer_subject !== req.viewer.subject) return notFromHere(req, res);
        const outPage = await store.boardPage(id);
        const remaining = ideas.forBoard({ accessibleOnly: Boolean(rawBoard.accessible_only), excludeTitles: (outPage ? outPage.quests : []).map((q) => q.title) });
        if (!remaining.length) return res.redirect(303, `/quests/boards/${encodeURIComponent(id)}?saved=0`);
        const idea = remaining[0];
        await store.createSuggestion({ boardId: id, subject: req.viewer.subject, title: idea.title, brief: idea.brief, category: idea.category, accessible: Boolean(idea.accessible), source: 'idea' });
        return res.redirect(303, `/quests/boards/${encodeURIComponent(id)}?saved=1`);
    });

    async function renderQuest(req, res, { problem = null, status = 200, flash = null } = {}) {
        const out = await store.questForPage(String(req.params.slug || ''), { subject: signedIn(req) ? req.viewer.subject : null, staff: staffViewer(req) });
        if (!out) return notFound(req, res);
        const live = await liveOf(out.quest.streamer_username);
        return page(req, res, {
            index: out.quest.visibility === 'public', cache: out.quest.visibility === 'public' ? PUBLIC_CACHE : null,
            title: out.quest.title,
            description: out.quest.brief.slice(0, 160),
            jsonLd: out.quest.visibility === 'public' ? [seo.jsonLd.webPage({ name: out.quest.title, url: `${base()}/q/${out.quest.slug}`, description: out.quest.brief.slice(0, 160), siteUrl: base() })] : [],
            body: raw(views.quest({ q: out.quest, board: out.board, live, signedIn: Boolean(signedIn(req)), voted: out.quest.voted, mine: out.quest.mine, staff: staffViewer(req), flash, problem, verifyVotes: config.quests.verifyVotes })),
        }, status);
    }
    r.get('/q/:slug', (req, res) => renderQuest(req, res, { flash: req.query.reported === '1' ? 'Thank you. Staff will look at the report.' : req.query.verified === '1' ? 'Verified; the badge is paid.' : null }));

    r.post('/q/:slug/vote', guard, async (req, res) => {
        const out = await store.castQuestVote({ slug: String(req.params.slug || ''), subject: req.viewer.subject, via: 'web' });
        if (!out.ok) return renderQuest(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/q/${encodeURIComponent(out.slug)}?voted=1`);
    });

    for (const [suffix, action] of [['accept', 'accept'], ['live', 'live'], ['complete', 'complete']]) {
        r.post(`/q/:slug/${suffix}`, guard, async (req, res) => {
            const slug = String(req.params.slug || '');
            const out = action === 'accept'
                ? await store.acceptQuest({ slug, subject: req.viewer.subject, staff: staffViewer(req) })
                : await store.setQuestStatus({ slug, subject: req.viewer.subject, staff: staffViewer(req), to: action });
            if (!out.ok) return renderQuest(req, res, { problem: out.message, status: out.status || 400 });
            return res.redirect(303, `/q/${encodeURIComponent(slug)}?saved=1`);
        });
    }

    r.post('/q/:slug/verify', guard, async (req, res) => {
        const slug = String(req.params.slug || '');
        const via = req.body && req.body.via === 'moderator' ? 'moderator' : 'chat';
        const out = await store.verifyQuest({ slug, subject: req.viewer.subject, staff: staffViewer(req), via });
        if (!out.ok) return renderQuest(req, res, { problem: out.message, status: out.status || 400 });
        if (out.reward) await coins.settle(out.reward, out.quest);
        return res.redirect(303, `/q/${encodeURIComponent(slug)}?verified=1`);
    });

    r.post('/q/:slug/hide', guard, async (req, res) => {
        if (!staffViewer(req)) return notFromHere(req, res);
        const out = await store.hideQuest({ slug: String(req.params.slug || ''), staff: true });
        if (!out.ok) return renderQuest(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, '/quests');
    });

    r.post('/q/:slug/report', guard, async (req, res) => {
        const quest = await store.byQuestSlug(String(req.params.slug || ''));
        if (!quest) return notFound(req, res);
        const b = req.body || {};
        const out = await store.createReport({ targetKind: 'quest', targetId: quest.id, subject: req.viewer.subject, kind: b.kind || 'safety', reason: b.reason, note: b.note });
        if (!out.ok) return renderQuest(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/q/${encodeURIComponent(quest.slug)}?reported=1`);
    });

    // ── Streamer dashboard ──────────────────────────────────
    r.get('/live', async (req, res) => {
        const subject = signedIn(req) ? req.viewer.subject : null;
        const boards = subject ? await store.boardForSubject(subject) : [];
        const quests = subject ? await store.questsForSubject(subject) : [];
        return page(req, res, {
            index: false, title: 'For streamers',
            body: raw(views.livePage({ boards, quests, signedIn: Boolean(subject) })),
        });
    });

    // ── Group plans ─────────────────────────────────────────
    r.get('/plans', async (req, res) => {
        const out = await store.listPlans({ limit: 30 });
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE,
            title: 'Group plans',
            description: 'Two or three options, one link, one vote each. The group picks the plan and the winner can go to Today.',
            jsonLd: [seo.jsonLd.webPage({ name: 'Group plans on OpenVibe.Fun', url: `${base()}/plans`, description: 'Decide a plan together and send the winner to Today.', siteUrl: base() })],
            body: raw(views.plans({ plans: out.plans })),
        });
    });

    r.get('/plans/new', (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Start a plan', body: raw(views.signIn({ title: 'Start a group plan', text: 'A plan belongs to your OpenVibe account; the group can vote with the link.', next: '/plans/new' })) }, 401);
        return page(req, res, { index: false, title: 'Start a group plan', body: raw(views.planNew({ values: { timezone: 'UTC' } })) });
    });

    r.post('/plans', guard, async (req, res) => {
        const b = req.body || {};
        const options = [1, 2, 3].map((i) => String(b[`option${i}_title`] || '').trim()).filter(Boolean).map((title) => ({ title }));
        const out = await store.createPlan({
            ownerSubject: req.viewer.subject, ownerUsername: req.viewer.username,
            title: b.title, summary: b.summary, city: b.city, timezone: b.timezone, startsAt: b.starts_at, closesAt: b.closes_at,
            visibility: b.visibility, chatUsername: b.chat_username, options,
        });
        if (!out.ok) {
            const values = { ...formValues(b, ['title', 'summary', 'city', 'starts_at', 'closes_at', 'timezone', 'visibility', 'chat_username']) };
            for (const i of [1, 2, 3]) values[`option${i}_title`] = b[`option${i}_title`] || '';
            return page(req, res, { title: 'Start a group plan', body: raw(views.planNew({ values, problem: out.message })) }, out.status || 400);
        }
        return res.redirect(303, `/plans/${encodeURIComponent(out.plan.slug)}`);
    });

    async function renderPlan(req, res, { problem = null, status = 200, flash = null } = {}) {
        const out = await store.planForPage(String(req.params.slug || ''), { subject: signedIn(req) ? req.viewer.subject : null, staff: staffViewer(req) });
        if (!out) return notFound(req, res);
        return page(req, res, {
            index: out.plan.visibility === 'public', cache: out.plan.visibility === 'public' ? PUBLIC_CACHE : null,
            title: out.plan.title,
            description: (out.plan.summary || 'A group plan on OpenVibe.Fun').slice(0, 160),
            jsonLd: out.plan.visibility === 'public' ? [seo.jsonLd.webPage({ name: out.plan.title, url: `${base()}/plans/${out.plan.slug}`, description: (out.plan.summary || 'A group plan on OpenVibe.Fun').slice(0, 160), siteUrl: base() })] : [],
            body: raw(views.plan({ p: out.plan, options: out.options, winner: out.winner, signedIn: Boolean(signedIn(req)), mine: out.isOwner, staff: staffViewer(req), flash, problem, myOptionId: out.plan.my_option_id, totalVotes: out.plan.total_votes })),
        }, status);
    }
    r.get('/plans/:slug', (req, res) => renderPlan(req, res, { flash: req.query.reported === '1' ? 'Thank you. Staff will look at the report.' : req.query.decided === '1' ? 'The winner is chosen.' : null }));

    r.post('/plans/:slug/options', guard, async (req, res) => {
        const b = req.body || {};
        const out = await store.addPlanOption({
            slug: String(req.params.slug || ''), subject: req.viewer.subject, staff: staffViewer(req),
            title: b.title, placeName: b.place_name, accessible: b.accessible === '1',
        });
        if (!out.ok) return renderPlan(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/plans/${encodeURIComponent(String(req.params.slug || ''))}`);
    });

    r.post('/plans/:slug/vote', guard, async (req, res) => {
        const b = req.body || {};
        const out = await store.castPlanVote({ slug: String(req.params.slug || ''), subject: req.viewer.subject, optionId: b.option_id || null, position: b.position || null, via: 'web' });
        if (!out.ok) return renderPlan(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/plans/${encodeURIComponent(String(req.params.slug || ''))}?voted=1`);
    });

    r.post('/plans/:slug/decide', guard, async (req, res) => {
        const out = await store.decidePlan({ slug: String(req.params.slug || ''), subject: req.viewer.subject, staff: staffViewer(req) });
        if (!out.ok) return renderPlan(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/plans/${encodeURIComponent(String(req.params.slug || ''))}?decided=1`);
    });

    r.post('/plans/:slug/today', guard, async (req, res) => {
        const out = await store.planForToday(String(req.params.slug || ''));
        if (!out) return notFound(req, res);
        if (out.error === 'not_decided') return renderPlan(req, res, { problem: 'Decide the plan before adding it to Today.', status: 409 });
        if (!out.winner) return renderPlan(req, res, { problem: 'This plan has no chosen option.', status: 409 });
        if (new Date(out.plan.starts_at).getTime() < Date.now() + 5 * 60_000) return renderPlan(req, res, { problem: 'The plan starts too soon to add it to Today.', status: 409 });
        if (!req.viewer.token) return renderPlan(req, res, { problem: 'Sign in again to add the plan to Today.', status: 401 });
        try {
            const created = await upstreams.todayCreate({ token: req.viewer.token, body: planEvent(config, out.plan, out.winner), idempotencyKey: `fun-plan-${out.plan.id}` });
            return res.redirect(303, created.url);
        } catch (err) {
            return renderPlan(req, res, { problem: err.message || 'OpenVibe.Today did not answer.', status: err.status || 502 });
        }
    });

    r.post('/plans/:slug/hide', guard, async (req, res) => {
        if (!staffViewer(req)) return notFromHere(req, res);
        const out = await store.hidePlan({ slug: String(req.params.slug || ''), staff: true });
        if (!out.ok) return renderPlan(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, '/plans');
    });

    r.post('/plans/:slug/report', guard, async (req, res) => {
        const plan = await store.planBySlug(String(req.params.slug || ''));
        if (!plan) return notFound(req, res);
        const b = req.body || {};
        const out = await store.createReport({ targetKind: 'plan', targetId: plan.id, subject: req.viewer.subject, kind: b.kind || 'safety', reason: b.reason, note: b.note });
        if (!out.ok) return renderPlan(req, res, { problem: out.message, status: out.status || 400 });
        return res.redirect(303, `/plans/${encodeURIComponent(plan.slug)}?reported=1`);
    });

    // ── OBS overlay, no Frame, no script, meta refresh only ──
    r.get('/overlay/q/:slug', async (req, res) => {
        const out = await store.questForPage(String(req.params.slug || ''), {});
        if (!out || out.quest.visibility !== 'public') { res.status(404).type('text/plain').send('No such public quest.'); return; }
        res.set('Cache-Control', 'no-store');
        res.set('X-Robots-Tag', 'noindex, nofollow');
        const live = await liveOf(out.quest.streamer_username);
        return res.type('html').send(views.overlay({ q: out.quest, votes: out.quest.votes, live }));
    });

    // ── Developers, discovery, 404 ──────────────────────────
    r.get('/developers', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE,
        title: 'The OpenVibe.Fun API',
        description: 'The JSON API, the Search documents, the public sources and the safety rules.',
        jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Fun API', url: `${base()}/developers`, description: 'The JSON API, the Search documents and the public sources.', siteUrl: base() })],
        body: raw(views.developers()),
    }));

    r.use(createDiscoveryRoutes(ctx));

    function notFound(req, res) {
        return page(req, res, { title: 'Not found', body: raw(views.notFound()) }, 404);
    }

    return r;
}

module.exports = { createPageRoutes };
