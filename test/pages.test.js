'use strict';
/**
 * Server-rendered pages: home (featured quests, plans, guide teaser), the quests list, a board share page, one
 * public quest/plan, the OBS overlay, developers, 404, cache headers and content-hashed assets. Public pages are
 * public, max-age=60; a page drawn for a signed-in person is private, no-store; a board share page is no-store.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { assetVersion } = require('../server/render/layout');

function jsonLd(html) {
    return [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

(async () => {
    const t = await boot();
    const alice = t.network.addUser('ada');
    const kim = t.network.addUser('kim');
    try {
        const future = new Date(Date.now() + 172_800_000).toISOString();
        const b = await t.get('/api/v1/quests/boards', { as: alice, json: { live_username: 'ada', title: 'Page board' } });
        const s = await t.get(`/api/v1/quests/boards/${b.json().id}/suggest`, { as: kim, json: { title: 'Find the best bench with a view', brief: 'Walk ten minutes and sit.', category: 'chill', accessible: true } });
        const quest = s.json();
        await t.get(`/api/v1/quests/${quest.slug}/vote`, { as: kim, json: {} });
        await t.get(`/api/v1/quests/${quest.slug}/accept`, { as: alice, json: {} });
        const p = await t.get('/api/v1/plans', { as: kim, json: { title: 'Friday with the group', summary: 'Two choices.', city: 'Portland', starts_at: future, timezone: 'UTC', visibility: 'public', options: [{ title: 'Mural walk', accessible: true }, { title: 'Bowling' }] } });
        const plan = p.json();

        await check('home: semantic, the featured quests and plans, the guide teaser, public cache with Vary: Cookie', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
            assert.strictEqual(r.headers.get('vary'), 'Cookie');
            for (const marker of ['id="fu-home"', 'id="fu-featured"', 'id="fu-plans"', 'id="fu-guide-teaser"', 'class="sc-room-scenes"', '<noscript><nav', '<footer id="ov-footer"', '<main id="main"', 'Find the best bench with a view', '/guide']) assert.ok(r.text.includes(marker), marker);
            const types = jsonLd(r.text).map((x) => x['@type']);
            assert.ok(types.includes('WebSite'), types.join(','));
            assert.ok(types.includes('WebApplication'), types.join(','));
        });

        await check('a page drawn for a signed-in person is private, no-store', async () => {
            const r = await t.get('/', { as: kim });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
            assert.strictEqual(r.headers.get('vary'), 'Cookie');
        });

        await check('/quests lists the public quest and the safe idea deck; a board share page is no-store', async () => {
            const r = await t.get('/quests');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('id="fu-quests"'));
            assert.ok(r.text.includes('id="fu-public-quests"'));
            assert.ok(r.text.includes('id="fu-ideas"'));
            assert.ok(r.text.includes('Find the best bench with a view'));
            assert.ok(r.text.includes('Find the oldest bar on this street'));
            const b2 = await t.get('/api/v1/quests/boards', { as: alice, json: { live_username: 'ada', title: 'Open board' } });
            const board = await t.get(`/quests/boards/${b2.json().id}`, { as: kim });
            assert.strictEqual(board.status, 200);
            assert.ok(board.text.includes('id="fu-board"'));
            assert.ok(board.text.includes('id="fu-board-quests"'));
            assert.ok(board.text.includes('id="fu-suggest-form"'));
            assert.strictEqual(board.headers.get('cache-control'), 'private, no-store');
        });

        await check('one quest page carries the actions, the report form and the overlay link', async () => {
            const r = await t.get(`/q/${quest.slug}`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
            assert.ok(r.text.includes('id="fu-quest"'));
            assert.ok(r.text.includes('id="fu-quest-actions"'));
            assert.ok(r.text.includes('id="fu-quest-report"'));
            assert.ok(r.text.includes(`/overlay/q/${quest.slug}`));
            assert.ok(r.text.includes('Find the best bench with a view'));
            const ov = await t.get(`/overlay/q/${quest.slug}`);
            assert.strictEqual(ov.status, 200);
            assert.ok(ov.text.includes('id="fu-overlay"'));
            assert.ok(ov.text.includes('http-equiv="refresh"'));
            assert.strictEqual(ov.headers.get('x-robots-tag'), 'noindex, nofollow');
        });

        await check('one plan page carries the options, votes and the Today action', async () => {
            const r = await t.get(`/plans/${plan.slug}`, { as: kim });
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('id="fu-plan"'));
            assert.ok(r.text.includes('id="fu-plan-options"'));
            assert.ok(r.text.includes('id="fu-plan-actions"'));
            assert.ok(r.text.includes('Mural walk'));
            assert.ok(r.text.includes('Bowling'));
            assert.ok(r.text.includes('Decide the winner'));
        });

        await check('/developers, the 404 and no-JS page structure', async () => {
            const dev = await t.get('/developers');
            assert.strictEqual(dev.status, 200);
            assert.strictEqual(dev.headers.get('cache-control'), 'public, max-age=60');
            assert.ok(dev.text.includes('id="fu-developers"'));
            assert.ok(dev.text.includes('/api/v1/quests'));
            const nf = await t.get('/no/such/page');
            assert.strictEqual(nf.status, 404);
            assert.match(nf.headers.get('content-type'), /^text\/html/);
            assert.ok(nf.text.includes('id="fu-not-found"'));
            for (const p of ['/', '/guide', '/quests', '/plans', '/developers']) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 200, p);
                assert.match(r.text, /<noscript><nav/);
                assert.match(r.text, /<footer id="ov-footer"/);
                assert.match(r.text, /<main id="main"/);
            }
        });

        await check('assets are content-hashed; robots, sitemap and llms list the public pages', async () => {
            const v = assetVersion('css/fun.css');
            const hashed = await t.get(`/css/fun.css?v=${v}`);
            assert.strictEqual(hashed.status, 200);
            assert.strictEqual(hashed.headers.get('cache-control'), 'public, max-age=31536000, immutable');
            const wrong = await t.get('/css/fun.css?v=deadbeefdeadbeef');
            assert.strictEqual(wrong.status, 200);
            assert.strictEqual(wrong.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=86400');
            const css = await t.get('/css/fun.css');
            assert.match(css.text, /OpenVibe\.Fun: the room's own pieces/, 'the designed stylesheet');
            const js = await t.get('/js/fun.js');
            assert.match(js.headers.get('content-type'), /javascript/);
            assert.strictEqual((js.text.match(/function/g) || []).length, 0, 'fun.js is a one-comment placeholder');
            const robots = await t.get('/robots.txt');
            assert.match(robots.text, /Disallow: \/api\//);
            assert.match(robots.text, /Disallow: \/overlay\//);
            const map = await t.get('/sitemap.xml');
            assert.strictEqual(map.status, 200);
            assert.ok(map.text.includes(`https://openvibe.fun/q/${quest.slug}`));
            assert.ok(map.text.includes(`https://openvibe.fun/plans/${plan.slug}`));
            const llms = await t.get('/llms.txt');
            assert.strictEqual(llms.status, 200);
            assert.ok(llms.text.includes('OpenVibe.Fun'));
            const full = await t.get('/llms-full.txt');
            assert.strictEqual(full.status, 200);
            assert.ok(full.text.includes('Find the best bench with a view'));
        });
    } finally {
        await t.close();
    }
    done();
})();
