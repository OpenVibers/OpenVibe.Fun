'use strict';
/**
 * The local guide: OpenStreetMap through Nominatim/Overpass with a contact User-Agent, a bounded around: query and a
 * cache; the accessibility/rainy/kids/cheap filters; Ticketmaster off by default and only read when a key is set;
 * and the pacer's one-request-a-second contract. No API key ever appears in a response or a log line.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createPacer } = require('../server/guide/upstream');

(async () => {
    await check('the pacer leaves at least the configured gap between calls', async () => {
        let clock = 0; const sleeps = [];
        const pacer = createPacer({ minIntervalMs: 1000, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
        await pacer.run(() => { clock += 10; return 'a'; });
        await pacer.run(() => { clock += 10; return 'b'; });
        assert.deepStrictEqual(sleeps, [990]);
    });

    const t = await boot();
    try {
        await check('the guide geocodes once, queries a bounded area and caches both answers', async () => {
            const first = await t.get('/api/v1/guide?q=portland');
            assert.strictEqual(first.status, 200, first.text);
            const b = first.json();
            assert.strictEqual(b.location.display_name.includes('Portland'), true);
            assert.strictEqual(b.results.length, 4);
            assert.strictEqual(b.attribution.text, '© OpenStreetMap contributors');
            assert.strictEqual(b.attribution.license, 'ODbL 1.0');
            assert.ok(b.results.every((r) => /^https:\/\/www\.openstreetmap\.org\//.test(r.osm_url)));
            assert.ok(b.results.every((r) => r.distance_km >= 0 && r.map_url.includes('openstreetmap.org')));
            assert.strictEqual(b.events_configured, false);
            assert.deepStrictEqual(b.events, []);
            const geo = t.upstreams.requestsFor('/search');
            const over = t.upstreams.requestsFor('/interpreter');
            assert.strictEqual(geo.length, 1);
            assert.strictEqual(over.length, 1);
            assert.match(geo[0].headers['user-agent'], /^OpenVibeFun\/0\.1 \(\+https:\/\/openvibe\.fun/);
            assert.match(geo[0].headers['user-agent'], /contact@openvibe\.network/);
            assert.match(over[0].body, /around%3A/);
            assert.match(over[0].body, /out%20center%20tags/);
            const second = await t.get('/api/v1/guide?q=portland');
            assert.strictEqual(second.status, 200);
            assert.strictEqual(second.json().cached, true);
            assert.strictEqual(t.upstreams.requestsFor('/search').length, 1, 'the second lookup is cached');
            assert.strictEqual(t.upstreams.requestsFor('/interpreter').length, 1, 'the second area query is cached');
        });

        await check('accessible, rainy, kids and cheap narrow the same answer', async () => {
            const accessible = (await t.get('/api/v1/guide?q=portland&accessible=1')).json();
            assert.ok(accessible.results.every((r) => r.wheelchair === true), JSON.stringify(accessible.results.map((r) => [r.name, r.wheelchair])));
            assert.strictEqual(accessible.results.length, 3);
            const rainy = (await t.get('/api/v1/guide?q=portland&rainy=1')).json();
            assert.ok(rainy.results.every((r) => r.indoor));
            assert.deepStrictEqual(rainy.results.map((r) => r.name).sort(), ['City Museum', 'Rainy Day Café']);
            const kids = (await t.get('/api/v1/guide?q=portland&kids=1')).json();
            assert.deepStrictEqual(kids.results.map((r) => r.name).sort(), ['City Museum', 'Playground']);
            const cheap = (await t.get('/api/v1/guide?q=portland&cheap=1')).json();
            assert.ok(cheap.results.every((r) => r.fee !== true));
        });

        await check('unknown places are 404, a bad kind is 422, and Ticketmaster is never called without a key', async () => {
            const missing = await t.get('/api/v1/guide?q=nowhere');
            assert.strictEqual(missing.status, 404);
            assert.strictEqual(missing.json().code, 'fun.guide.not_found');
            const bad = await t.get('/api/v1/guide?q=portland&kind=nope');
            assert.strictEqual(bad.status, 422);
            assert.strictEqual(bad.json().code, 'fun.guide.invalid');
            assert.strictEqual(t.upstreams.state.requests.filter((r) => r.path.includes('discovery')).length, 0);
            const noQuery = await t.get('/api/v1/guide');
            assert.strictEqual(noQuery.status, 422);
        });

        await check('the page has the form, the result, the tile-free map and the OSM credit', async () => {
            const r = await t.get('/guide?q=portland');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('id="fu-guide"'));
            assert.ok(r.text.includes('id="fu-guide-form"'));
            assert.ok(r.text.includes('id="fu-guide-results"'));
            assert.ok(r.text.includes('id="fu-map"'));
            assert.ok(r.text.includes('City Museum'));
            assert.ok(r.text.includes('© OpenStreetMap'));
            assert.ok(r.text.includes('Riverside Park'));
            assert.ok(r.text.includes('/plans/new?title=City%20Museum'));
            assert.ok(r.text.includes('Ticketmaster is not configured'));
        });
    } finally {
        await t.close();
    }

    const tm = await boot({ env: { TICKETMASTER_API_KEY: 'tm-test-key' } });
    try {
        await check('with a key, Ticketmaster events are read once, shown with local times and a link, and the key is never returned', async () => {
            const r = await tm.get('/api/v1/guide?q=portland');
            assert.strictEqual(r.status, 200, r.text);
            const b = r.json();
            assert.strictEqual(b.events_configured, true);
            assert.strictEqual(b.events.length, 1);
            assert.strictEqual(b.events[0].name, 'Night Market');
            assert.strictEqual(b.events[0].venue, 'Hall');
            assert.strictEqual(b.events[0].city, 'Portland');
            assert.ok(b.events[0].starts_at.startsWith('2026-11-01'));
            assert.strictEqual(b.events[0].url, 'https://www.ticketmaster.com/event/tm1');
            assert.ok(!r.text.includes('tm-test-key'));
            const calls = tm.upstreams.state.requests.filter((x) => x.path.includes('discovery'));
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].query.apikey, 'tm-test-key');
            assert.ok(!tm.logs().includes('tm-test-key'), 'the key is never logged');
            const page = await tm.get('/guide?q=portland');
            assert.ok(page.text.includes('id="fu-guide-events"'));
            assert.ok(page.text.includes('Night Market'));
            assert.ok(page.text.includes('Tickets and details'));
            assert.strictEqual(tm.upstreams.state.requests.filter((x) => x.path.includes('discovery')).length, 1, 'the event answer is cached');
        });
    } finally {
        await tm.close();
    }
    done();
})();
