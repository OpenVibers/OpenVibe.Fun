'use strict';
/**
 * The queued Search documents reach OpenVibe.Search (server/app.js, openvibe-publishing/search-relay): with
 * FUN_SEARCH_URL set, accepting a quest PUTs its document to Search's owner API with a service token for
 * openvibe.search, and the row leaves the queue. Without the URL the relay is off and the rows wait.
 */
const assert = require('assert');
const http = require('http');
const { boot, check, done } = require('./helpers/boot');

function fakeSearch() {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: body ? JSON.parse(body) : null });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ outcome: 'applied' }));
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) })));
}

(async () => {
    const search = await fakeSearch();
    const t = await boot({ env: { FUN_SEARCH_URL: search.url } });
    try {
        const ada = t.network.addUser('ada');
        const kim = t.network.addUser('kim');

        await check('an accepted quest is PUT to Search with a service token, and the row leaves the queue', async () => {
            assert.strictEqual(t.ctx.searchRelay.enabled, true);
            const b = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Relay board' } });
            const quest = (await t.get(`/api/v1/quests/boards/${b.json().id}/suggest`, { as: kim, json: { title: 'Find the oldest tree', brief: 'Walk to the park.' } })).json();
            assert.strictEqual((await t.get(`/api/v1/quests/${quest.slug}/accept`, { as: ada, json: {} })).status, 200);
            const out = await t.ctx.searchRelay.drain();
            assert.ok(out.sent >= 1, JSON.stringify(out));
            const put = search.calls.find((c) => c.method === 'PUT' && c.url === `/api/v1/documents/fun/quest/${quest.id}`);
            assert.ok(put, JSON.stringify(search.calls.map((c) => `${c.method} ${c.url}`)));
            assert.match(put.auth, /^Bearer \S+/);
            assert.strictEqual(put.body.canonical_url, `https://openvibe.fun/q/${quest.slug}`);
            assert.strictEqual((await t.ctx.searchRelay.status()).pending, 0);
        });
    } finally {
        await t.close();
        await search.close();
    }

    const off = await boot();
    try {
        await check('without FUN_SEARCH_URL the relay is off', async () => {
            assert.strictEqual(off.ctx.searchRelay.enabled, false);
            assert.strictEqual(await off.ctx.searchRelay.drain(), null);
        });
    } finally {
        await off.close();
    }
    done();
})();
