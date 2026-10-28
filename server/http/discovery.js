'use strict';

/**
 * Crawl artifacts for openvibe.fun: robots.txt, sitemap.xml, llms.txt and llms-full.txt. Public quests and public
 * plans are for search engines; sign-in, the API, the internal route, a board share link, a plan's share page and
 * the OBS overlay are not. The sitemap lists every public quest and plan.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Fun';
const DESCRIPTION = 'OpenVibe.Fun is something to do, alone, together, or live: IRL quests on OpenVibe.Live, a local guide from OpenStreetMap, and group plans the group votes on.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/overlay/', '/quests/boards/', '/quests/new', '/live', '/plans/new'];

function dayOf(ts) {
    const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION }),
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'EntertainmentApplication', keywords: 'openvibe fun, irl quests, local guide, openstreetmap, group plans, things to do' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

function publicPages() {
    return [
        { path: '/', changefreq: 'daily', priority: 1.0, title: 'OpenVibe.Fun home', text: 'IRL quests on Live, the local guide and group plans.' },
        { path: '/guide', changefreq: 'weekly', priority: 0.9, title: 'The local guide', text: 'What is fun near me? Places from OpenStreetMap and local events when Ticketmaster is configured.' },
        { path: '/quests', changefreq: 'daily', priority: 0.9, title: 'IRL quests on Live', text: 'Safe real-world challenges suggested by viewers, voted by chat and accepted by a streamer.' },
        { path: '/plans', changefreq: 'daily', priority: 0.8, title: 'Group plans', text: 'Two or three options, one vote each, the winner goes to Today.' },
        { path: '/developers', changefreq: 'weekly', priority: 0.6, title: 'The OpenVibe.Fun API', text: 'The JSON API, the Search documents and the guide sources.' },
    ];
}

function createDiscoveryRoutes(ctx) {
    const { config, store } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });
    const pages = publicPages();

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.fun: the public quests, plans and guide are for search engines; sign-in, the API, boards,\n'
            + '# private plans and the overlay are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: 'OpenVibe.Fun is the room for something to do. IRL quests let a streamer\'s chat suggest safe real-world challenges, vote with !quest vote, and have the completion checked by chat or a moderator; the badge is paid locally and OpenCoins are loyalty points only when configured. The local guide answers "what\'s fun near me" from OpenStreetMap (Nominatim and Overpass, with a contact User-Agent, one request a second per host, a bounded radius and a seven-day cache) and Ticketmaster when a key is configured (off by default). Group plans have options, one vote per person, and a winner that the viewer can add to their own OpenVibe.Today with their own token.',
            details: 'GET /api/v1/guide?q=&kind=&accessible=&rainy=&kids=&cheap= answers with places (ODbL, © OpenStreetMap contributors) and, only when configured, Ticketmaster events. GET /api/v1/quests lists public IRL quests; GET /api/v1/quests/:slug adds votes and checks. GET /api/v1/plans lists public plans; GET /api/v1/plans/:slug adds options and votes. Chat votes are read from the public OpenVibe.Chat history; Fun never posts. No route needs a service token, and the one outbound write to Today uses the signed-in person\'s own token.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Fun', url: abs('/'), note: 'something to do, alone, together, or live' },
                    { title: 'The local guide', url: abs('/guide') },
                    { title: 'IRL quests', url: abs('/quests') },
                    { title: 'Group plans', url: abs('/plans') },
                    { title: 'The API', url: abs('/developers') },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'Public quests (JSON)', url: abs('/api/v1/quests') },
                    { title: 'Public plans (JSON)', url: abs('/api/v1/plans') },
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Full text for language models', url: abs('/llms-full.txt') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Live', url: 'https://openvibe.live', note: 'the streamer and the chat' },
                    { title: 'OpenVibe.Chat', url: 'https://openvibe.chat', note: 'where !quest and !plan votes are typed' },
                    { title: 'OpenVibe.Today', url: 'https://openvibe.today', note: 'the plan goes to your own calendar' },
                    { title: 'OpenVibe.Network', url: 'https://openvibe.network', note: 'accounts and staff roles' },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        const [quests, plans] = await Promise.all([store.publicQuestsForLlms(2000), store.publicPlansForLlms(2000)]);
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public page of OpenVibe.Fun: the guide, public IRL quests, public group plans and the API.',
            base: site,
            maxBytes: 512 * 1024,
            sections: [
                { title: 'Pages', pages: pages.map((p) => ({ url: p.path, title: p.title, text: p.text })) },
                { title: 'Quests', pages: quests.map((q) => ({ url: `/q/${q.slug}`, title: q.title, text: [q.category, q.status, q.city, q.brief].filter(Boolean).join(' · ') })) },
                { title: 'Plans', pages: plans.map((p) => ({ url: `/plans/${p.slug}`, title: p.title, text: [p.status, p.city, p.summary].filter(Boolean).join(' · ') })) },
            ],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        const [quests, plans] = await Promise.all([store.publicQuestsForSitemap(5000), store.publicPlansForSitemap(5000)]);
        const urls = [
            ...pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...quests.map((e) => ({ loc: abs(`/q/${e.slug}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'weekly', priority: 0.7 })),
            ...plans.map((e) => ({ loc: abs(`/plans/${e.slug}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'weekly', priority: 0.6 })),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME };
