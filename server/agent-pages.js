'use strict';
// The public pages the agent layer serves as Markdown twins (openvibe-shared/agent-layer), rendered through the
// same views and layout as the HTML routes and always signed out: a board's streamer forms, a quest's vote/report
// actions and a plan's options are never in a twin, and a non-public quest or plan has no twin at all.
const seo = require('openvibe-shared/seo');
const views = require('./views');
const ideas = require('./quests/ideas');
const { raw } = require('./render/html');
const { renderPage } = require('./render/layout');
const { homeJsonLd } = require('./http/discovery');

function createAgentPages(ctx) {
    const { config, store, upstreams, guide } = ctx;
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const page = (path, o) => ({ html: renderPage({ viewer: { kind: 'anonymous' }, config, path, agentLayer: true, ...o }), title: o.title });

    async function liveOf(username) {
        try { return await upstreams.liveChannel(username); } catch { return null; }
    }

    async function home() {
        const [counts, featured, planOut] = await Promise.all([store.counts(), store.featuredQuests(6), store.listPlans({ limit: 4 })]);
        return page('/', {
            index: true, title: null,
            description: 'Something to do, alone, together, or live: IRL quests on OpenVibe.Live, a local guide from OpenStreetMap, and group plans that the group votes on.',
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ counts, featured, plans: planOut.plans })),
        });
    }

    async function guidePage(query) {
        const values = {
            q: typeof query.get('q') === 'string' ? query.get('q') : '',
            kind: typeof query.get('kind') === 'string' && query.get('kind') ? query.get('kind') : 'all',
            radius: typeof query.get('radius') === 'string' ? query.get('radius') : '',
            accessible: query.get('accessible') === '1', rainy: query.get('rainy') === '1',
            kids: query.get('kids') === '1', cheap: query.get('cheap') === '1',
        };
        let result = null; let problem = null;
        if (values.q.trim()) {
            try {
                result = await guide.search({
                    q: values.q, kind: values.kind, radiusKm: values.radius ? Number(values.radius) : null,
                    accessible: values.accessible, rainy: values.rainy, kids: values.kids, cheap: values.cheap,
                });
            } catch (err) {
                problem = (err && err.message) || 'The guide could not answer just now.';
            }
        }
        return page('/guide', {
            index: true, title: 'The local guide',
            description: 'What\'s fun near me? Places from OpenStreetMap and local events from Ticketmaster when a key is configured, with a map, times and links.',
            jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Fun local guide', url: `${base()}/guide`, description: 'Places from OpenStreetMap, local events when Ticketmaster is configured.', siteUrl: base() })],
            body: raw(views.guide({ values, result, error: problem })),
        });
    }

    async function renderPublicPage(rawPath, { query } = {}) {
        const p = String(rawPath || '/').replace(/\/+$/, '') || '/';
        const q = query instanceof URLSearchParams ? query : new URLSearchParams();
        if (p === '/') return home();
        if (p === '/guide') return guidePage(q);
        if (p === '/quests') {
            const out = await store.listQuests({ limit: 30 });
            return page(p, {
                index: true, title: 'IRL quests on Live',
                description: 'Viewers suggest, chat votes, the streamer accepts and a moderator or the chat verifies. Safe, accessible challenges for the real world.',
                jsonLd: [seo.jsonLd.webPage({ name: 'IRL quests on OpenVibe.Live', url: `${base()}/quests`, description: 'Safe IRL challenges for streamers and their chat.', siteUrl: base() })],
                body: raw(views.quests({ quests: out.quests, ideas: ideas.IDEAS })),
            });
        }
        if (p === '/plans') {
            const out = await store.listPlans({ limit: 30 });
            return page(p, {
                index: true, title: 'Group plans',
                description: 'Two or three options, one link, one vote each. The group picks the plan and the winner can go to Today.',
                jsonLd: [seo.jsonLd.webPage({ name: 'Group plans on OpenVibe.Fun', url: `${base()}/plans`, description: 'Decide a plan together and send the winner to Today.', siteUrl: base() })],
                body: raw(views.plans({ plans: out.plans })),
            });
        }
        if (p === '/developers') {
            return page(p, {
                index: true, title: 'The OpenVibe.Fun API',
                description: 'The JSON API, the Search documents, the public sources and the safety rules.',
                jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Fun API', url: `${base()}/developers`, description: 'The JSON API, the Search documents and the public sources.', siteUrl: base() })],
                body: raw(views.developers()),
            });
        }
        const boardMatch = p.match(/^\/quests\/boards\/([^/]+)$/);
        if (boardMatch) {
            let id;
            try { id = decodeURIComponent(boardMatch[1]); } catch { return null; }
            const out = await store.boardPage(id);
            if (!out) return null;
            const live = await liveOf(out.board.live_username);
            return page(p, {
                index: false, title: out.board.title,
                body: raw(views.board({ board: out.board, quests: out.quests, live, signedIn: false, mine: false, staff: false, flash: null })),
            });
        }
        const questMatch = p.match(/^\/q\/([^/]+)$/);
        if (questMatch) {
            let slug;
            try { slug = decodeURIComponent(questMatch[1]); } catch { return null; }
            const out = await store.questForPage(slug, { subject: null, staff: false });
            if (!out || out.quest.visibility !== 'public') return null;
            const live = await liveOf(out.quest.streamer_username);
            return page(p, {
                index: true, title: out.quest.title, description: out.quest.brief.slice(0, 160),
                jsonLd: [seo.jsonLd.webPage({ name: out.quest.title, url: `${base()}/q/${out.quest.slug}`, description: out.quest.brief.slice(0, 160), siteUrl: base() })],
                body: raw(views.quest({ q: out.quest, board: out.board, live, signedIn: false, voted: false, mine: false, staff: false, flash: null, problem: null, verifyVotes: config.quests.verifyVotes })),
            });
        }
        const planMatch = p.match(/^\/plans\/([^/]+)$/);
        if (planMatch) {
            let slug;
            try { slug = decodeURIComponent(planMatch[1]); } catch { return null; }
            const out = await store.planForPage(slug, { subject: null, staff: false });
            if (!out || out.plan.visibility !== 'public') return null;
            return page(p, {
                index: true, title: out.plan.title, description: (out.plan.summary || 'A group plan on OpenVibe.Fun').slice(0, 160),
                jsonLd: [seo.jsonLd.webPage({ name: out.plan.title, url: `${base()}/plans/${out.plan.slug}`, description: (out.plan.summary || 'A group plan on OpenVibe.Fun').slice(0, 160), siteUrl: base() })],
                body: raw(views.plan({ p: out.plan, options: out.options, winner: out.winner, signedIn: false, mine: false, staff: false, flash: null, problem: null, myOptionId: out.plan.my_option_id || null, totalVotes: out.plan.total_votes })),
            });
        }
        return null;
    }

    return { renderPublicPage };
}

module.exports = { createAgentPages };
