'use strict';
/** The agent layer: the manifest and the Markdown twins of the public pages, rendered through the same views. */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('manifest is JSON with only the endpoints Fun really serves', async () => {
            const r = await t.get('/.well-known/agent.json');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /application\/json/);
            const m = r.json();
            assert.strictEqual(m.id, 'fun');
            assert.strictEqual(m.home, 'https://openvibe.fun');
            assert.strictEqual(m.api, 'https://openvibe.fun/api/v1');
            assert.strictEqual(m.docs, 'https://openvibe.fun/developers');
            assert.deepStrictEqual(m.policy.auth, ['none', 'Network OIDC']);
            assert.strictEqual(m.openapi, undefined);
            assert.strictEqual(m.mcp, undefined);
        });

        await check('the home names its twin in the head and the Link header', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('<link rel="alternate" type="text/markdown" href="https://openvibe.fun/index.md">'));
            assert.match(r.headers.get('link'), /https:\/\/openvibe\.fun\/index\.md>; rel="alternate"; type="text\/markdown"/);
        });

        await check('/index.md and a content twin are Markdown of the same pages; unknown twins are 404', async () => {
            const home = await t.get('/index.md');
            assert.strictEqual(home.status, 200);
            assert.match(home.headers.get('content-type'), /text\/markdown/);
            assert.ok(home.text.startsWith('---\ntitle:'));
            const dev = await t.get('/developers.md');
            assert.strictEqual(dev.status, 200);
            assert.ok(dev.text.includes('# The OpenVibe.Fun API'));
            assert.strictEqual((await t.get('/no-such-page.md')).status, 404);
            assert.strictEqual((await t.get('/live.md')).status, 404, 'the streamer dashboard has no twin');
        });

        await check('/.well-known/security.txt is not swallowed by the layer, and robots names the manifest', async () => {
            const sec = await t.get('/.well-known/security.txt');
            assert.strictEqual(sec.status, 404);
            assert.doesNotMatch(sec.headers.get('content-type') || '', /application\/json/);
            const robots = await t.get('/robots.txt');
            assert.strictEqual(robots.status, 200);
            assert.ok(robots.text.includes('# Agent manifest: https://openvibe.fun/.well-known/agent.json'));
        });
    } finally {
        await t.close();
        done();
    }
})();
