'use strict';
/**
 * OpenCoins are opt-in and are loyalty points, never money. With FUN_COINS=on and the Network grant, a verified
 * quest credits 25 OpenCoins through Network's internal API with Fun's own service token, the subject's Network
 * user id, app_id fun, and the reward id as the idempotency key. The token and the key are never in a response.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot({ env: { FUN_COINS: 'on' } });
    try {
        const ada = t.network.addUser('ada');
        const mod = t.network.addUser('mod', { role: 'global_mod' });
        const b = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Coins board' } });
        const s = await t.get(`/api/v1/quests/boards/${b.json().id}/suggest`, { as: ada, json: { title: 'Find the best bench', brief: 'Walk ten minutes.' } });
        const q = s.json();
        await t.get(`/api/v1/quests/${q.slug}/accept`, { as: ada, json: {} });
        await t.get(`/api/v1/quests/${q.slug}/live`, { as: ada, json: {} });
        await t.get(`/api/v1/quests/${q.slug}/complete`, { as: ada, json: {} });

        await check('verifying credits OpenCoins once, with app_id fun and the reward id as the idempotency key', async () => {
            const v = await t.get(`/api/v1/quests/${q.slug}/verify`, { as: mod, json: { via: 'moderator' } });
            assert.strictEqual(v.status, 200, v.text);
            assert.strictEqual(v.json().status, 'verified');
            assert.strictEqual(v.json().reward.state, 'credited');
            assert.strictEqual(t.network.coinCredits.length, 1);
            const credit = t.network.coinCredits[0];
            assert.strictEqual(credit.app_id, 'fun');
            assert.strictEqual(credit.amount, 25);
            assert.strictEqual(credit.user_id, 42);
            assert.strictEqual(credit.reason, `fun:${q.slug}`);
            assert.strictEqual(credit.ref, `https://openvibe.fun/q/${q.slug}`);
            const row = await t.ctx.s.db.maybe('SELECT * FROM fun_quest_rewards WHERE quest_id = $1', [q.id]);
            assert.strictEqual(credit.idempotency_key, row.id);
            assert.strictEqual(row.state, 'credited');
            const tokens = t.network.tokenRequests.filter((x) => x.grant_type === 'client_credentials');
            assert.strictEqual(tokens.length, 1);
            assert.strictEqual(tokens[0].audience, 'openvibe.network');
            assert.match(tokens[0].scope, /identity\.subject\.resolve/);
            assert.match(tokens[0].scope, /network\.coins\.credit/);
            assert.ok(!v.text.includes('tok_'), 'no token in the response');
            assert.ok(!t.logs().includes('tok_'), 'no token in the log');
        });

        await check('a replayed verification changes nothing and credits once', async () => {
            const v = await t.get(`/api/v1/quests/${q.slug}/verify`, { as: mod, json: { via: 'moderator' } });
            assert.strictEqual(v.status, 200);
            assert.strictEqual(t.network.coinCredits.length, 1);
        });
    } finally {
        await t.close();
    }
    done();
})();
