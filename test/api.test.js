'use strict';
/**
 * The JSON API's refusals: application/problem+json with a stable code, an unreadable cursor, a bad limit/status,
 * an anonymous write and an app token that is not a person. The public read shapes are exercised by the feature
 * tests; this file is the edge contract.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('problem+json is used for a malformed body and an unknown route', async () => {
            const bad = await t.get('/api/v1/plans', { as: t.network.addUser('kim'), body: '{', headers: { 'content-type': 'application/json' } });
            assert.strictEqual(bad.status, 400);
            assert.match(bad.headers.get('content-type'), /application\/problem\+json/);
            assert.strictEqual(bad.json().code, 'request.malformed_json');
            const nope = await t.get('/api/v1/nope');
            assert.strictEqual(nope.status, 404);
            assert.strictEqual(nope.json().code, 'route.not_found');
        });

        await check('a bad limit, status or cursor is a 400 fun.invalid', async () => {
            for (const p of ['/api/v1/quests?limit=0', '/api/v1/quests?status=hidden', '/api/v1/quests?cursor=garbage', '/api/v1/plans?limit=0', '/api/v1/plans?cursor=garbage']) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 400, `${p}: ${r.text}`);
                assert.strictEqual(r.json().code, 'fun.invalid', p);
            }
            const ideas = await t.get('/api/v1/quests/ideas');
            assert.strictEqual(ideas.status, 200);
            assert.ok(ideas.json().count >= 8);
            assert.ok(ideas.json().ideas.every((i) => i.title && i.brief && i.category));
        });

        await check('an anonymous write is 401; an app token is 403, never silently a person', async () => {
            const anon = await t.get('/api/v1/quests/anything/vote', { json: {} });
            assert.strictEqual(anon.status, 401);
            assert.strictEqual(anon.json().code, 'fun.sign_in_required');
            const user = t.network.addUser('kim');
            const now = Math.floor(Date.now() / 1000);
            const app = t.network.signJwt({ iss: t.network.issuer(), sub: 'app:app_01JABCDEFGHJKMNPQRSTVWXYZ0', actor_type: 'app', aud: ['openvibe.fun'], cap: ['x.y.z'], project_id: 'prj_01JABCDEFGHJKMNPQRSTVWXYZ0', env: 'production', jti: 'app-test', subject_id: user.subject, iat: now, exp: now + 300 });
            const r = await t.get('/api/v1/plans', { bearer: app, json: { title: 'No' } });
            assert.strictEqual(r.status, 403);
            assert.strictEqual(r.json().code, 'fun.person_required');
        });

        await check('a missing guide query or place is an application problem', async () => {
            const noQuery = await t.get('/api/v1/guide');
            assert.strictEqual(noQuery.status, 422);
            assert.strictEqual(noQuery.json().code, 'fun.guide.invalid');
            const missing = await t.get('/api/v1/guide?q=nowhere');
            assert.strictEqual(missing.status, 404);
            assert.strictEqual(missing.json().code, 'fun.guide.not_found');
        });
    } finally {
        await t.close();
    }
    done();
})();
