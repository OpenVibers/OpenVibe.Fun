'use strict';
/**
 * IRL quests on Live: a streamer opens a board (the public Live channel and Network username must match), viewers
 * suggest, chat or the page votes, the owner accepts exactly one, marks it live/completed, and a chat quorum or a
 * moderator verifies it. The safety filter refuses dangerous/illegal/harassment suggestions before they are stored;
 * staff can hide a public quest and report handling stays staff-only.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        const ada = t.network.addUser('ada');
        const bo = t.network.addUser('bo');
        const kim = t.network.addUser('kim');
        const mod = t.network.addUser('mod', { role: 'global_mod' });

        await check('a board needs the signed-in username to match the public Live channel', async () => {
            const wrongUser = await t.get('/api/v1/quests/boards', { as: bo, json: { live_username: 'ada', title: 'Not mine' } });
            assert.strictEqual(wrongUser.status, 403);
            assert.strictEqual(wrongUser.json().code, 'fun.streamer_username');
            const missing = await t.get('/api/v1/quests/boards', { as: bo, json: { live_username: 'nobody', title: 'No channel' } });
            assert.strictEqual(missing.status, 404);
            assert.strictEqual(missing.json().code, 'fun.channel_not_found');
            const notFromHere = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Cross site' }, origin: 'https://evil.example' });
            assert.strictEqual(notFromHere.status, 403);
            assert.strictEqual(notFromHere.json().code, 'fun.cross_site');
        });

        let board = null;
        let first = null;
        await check('a board opens, an accessible-only board refuses a non-accessible suggestion, and a safe one is born unlisted', async () => {
            const r = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Saturday IRL quests', city: 'Portland, Oregon', max_suggestions: 5 } });
            assert.strictEqual(r.status, 201, r.text);
            board = r.json();
            assert.strictEqual(board.status, 'open');
            assert.strictEqual(board.chat_username, 'ada');
            const acc = await t.get('/api/v1/quests/boards', { as: bo, json: { live_username: 'bo', title: 'Accessible board', accessible_only: true } });
            assert.strictEqual(acc.status, 201);
            const no = await t.get(`/api/v1/quests/boards/${acc.json().id}/suggest`, { as: kim, json: { title: 'Find the best bench with a view', accessible: false } });
            assert.strictEqual(no.status, 422);
            assert.strictEqual(no.json().code, 'fun.quest.accessible_only');
            const s = await t.get(`/api/v1/quests/boards/${board.id}/suggest`, { as: kim, json: { title: 'Find the best bench with a view', brief: 'Walk ten minutes and sit.', category: 'chill', accessible: true } });
            assert.strictEqual(s.status, 201, s.text);
            first = s.json();
            assert.strictEqual(first.status, 'suggested');
            assert.strictEqual(first.visibility, 'unlisted');
            const list = await t.get('/api/v1/quests');
            assert.ok(!list.json().quests.some((q) => q.slug === first.slug), 'a suggestion is not public');
        });

        await check('the safety filter refuses danger, illegality and harassment before a row is written', async () => {
            for (const title of ['Climb a bridge and jump off', 'Trespass into the old factory', 'Harass a stranger until they react', 'Steal a sign from the bar']) {
                const r = await t.get(`/api/v1/quests/boards/${board.id}/suggest`, { as: kim, json: { title } });
                assert.strictEqual(r.status, 422, `${title}: ${r.text}`);
                assert.match(r.json().code, /^fun\.quest\.(danger|illegal|harassment)$/);
            }
            const count = Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM fun_quests WHERE board_id = $1', [board.id]));
            assert.strictEqual(count, 1);
        });

        await check('one vote per person; the owner accepts exactly one and it becomes public and searchable', async () => {
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/vote`, { as: kim, json: {} })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/vote`, { as: bo, json: {} })).status, 200);
            const again = await t.get(`/api/v1/quests/${first.slug}/vote`, { as: kim, json: {} });
            assert.strictEqual(again.json().votes, 2);
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/accept`, { as: bo, json: {} })).status, 403);
            const acc = await t.get(`/api/v1/quests/${first.slug}/accept`, { as: ada, json: {} });
            assert.strictEqual(acc.status, 200, acc.text);
            assert.strictEqual(acc.json().visibility, 'public');
            assert.strictEqual(acc.json().status, 'accepted');
            const pub = await t.get('/api/v1/quests');
            assert.ok(pub.json().quests.some((q) => q.slug === first.slug));
            const row = await t.ctx.s.db.maybe("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.upserted' ORDER BY created_at DESC LIMIT 1");
            assert.strictEqual(contracts.validate('search.index-document@1', row.payload).valid, true);
            assert.strictEqual(row.payload.type, 'quest');
            assert.strictEqual(row.payload.canonical_url, `https://openvibe.fun/q/${first.slug}`);
            assert.strictEqual(row.payload.facets.accessible, true);
        });

        await check('the streamer moves it live and completed; the chat quorum or a moderator verifies and pays the badge', async () => {
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/complete`, { as: ada, json: {} })).status, 409);
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/live`, { as: ada, json: {} })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/quests/${first.slug}/complete`, { as: ada, json: {} })).status, 200);
            const noQuorum = await t.get(`/api/v1/quests/${first.slug}/verify`, { as: ada, json: { via: 'chat' } });
            assert.strictEqual(noQuorum.status, 409);
            assert.strictEqual(noQuorum.json().code, 'fun.quest_quorum');
            for (const name of ['zoe', 'li', 'max']) {
                const out = await t.ctx.store.recordQuestCheck({ slug: first.slug, chatUsername: name, via: 'chat', chatMessageId: `m-${name}` });
                assert.strictEqual(out.ok, true, JSON.stringify(out));
            }
            const verify = await t.get(`/api/v1/quests/${first.slug}/verify`, { as: ada, json: { via: 'chat' } });
            assert.strictEqual(verify.status, 200, verify.text);
            assert.strictEqual(verify.json().status, 'verified');
            assert.strictEqual(verify.json().verification, 'chat');
            assert.ok(verify.json().reward_badge);
            assert.strictEqual(verify.json().reward.state, 'skipped', 'OpenCoins are off by default');
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_badges WHERE quest_id = $1', [first.id])), 1);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quest_rewards WHERE quest_id = $1', [first.id])), 1);
        });

        await check('a moderator can verify directly; staff can hide and the Search document becomes a tombstone', async () => {
            const b2 = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Second board' } });
            assert.strictEqual(b2.status, 201);
            const s = await t.get(`/api/v1/quests/boards/${b2.json().id}/suggest`, { as: kim, json: { title: 'Find a shop that sells only one thing', brief: 'Ask what it is and why.' } });
            assert.strictEqual(s.status, 201);
            const q = s.json();
            await t.get(`/api/v1/quests/${q.slug}/accept`, { as: ada, json: {} });
            await t.get(`/api/v1/quests/${q.slug}/live`, { as: ada, json: {} });
            await t.get(`/api/v1/quests/${q.slug}/complete`, { as: ada, json: {} });
            const v = await t.get(`/api/v1/quests/${q.slug}/verify`, { as: mod, json: { via: 'moderator' } });
            assert.strictEqual(v.status, 200, v.text);
            assert.strictEqual(v.json().verification, 'moderator');
            assert.strictEqual((await t.get(`/api/v1/quests/${q.slug}/hide`, { as: kim, method: 'POST' })).status, 403);
            const hide = await t.get(`/api/v1/quests/${q.slug}/hide`, { as: mod, method: 'POST' });
            assert.strictEqual(hide.status, 200);
            assert.strictEqual((await t.get(`/api/v1/quests/${q.slug}`)).status, 404);
            const tomb = await t.ctx.s.db.maybe("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.deleted' ORDER BY created_at DESC LIMIT 1");
            assert.strictEqual(tomb.payload.deleted, true);
            assert.strictEqual(tomb.payload.type, 'quest');
        });

        await check('a report is stored for a signed-in person and listed only for staff', async () => {
            const rep = await t.get(`/api/v1/quests/${first.slug}/report`, { as: kim, json: { kind: 'safety', reason: 'The place is not public', note: 'Check the address' } });
            assert.strictEqual(rep.status, 201, rep.text);
            assert.strictEqual((await t.get('/api/v1/reports', { as: kim })).status, 403);
            const list = await t.get('/api/v1/reports', { as: mod });
            assert.strictEqual(list.status, 200);
            assert.ok(list.json().reports.some((r) => r.target_slug === first.slug && r.kind === 'safety'));
        });

        await check('the quest page has the vote, the streamer actions, the report form and the overlay', async () => {
            const r = await t.get(`/q/${first.slug}`, { as: kim });
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('id="fu-quest"'));
            assert.ok(r.text.includes('id="fu-quest-actions"'));
            assert.ok(r.text.includes('id="fu-report-form"'));
            assert.ok(r.text.includes(`/overlay/q/${first.slug}`));
            assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
            const pub = await t.get(`/q/${first.slug}`);
            assert.strictEqual(pub.headers.get('cache-control'), 'public, max-age=60');
            const ov = await t.get(`/overlay/q/${first.slug}`);
            assert.strictEqual(ov.status, 200);
            assert.ok(ov.text.includes('id="fu-overlay"'));
            assert.ok(ov.text.includes('http-equiv="refresh"'));
            assert.ok(ov.text.includes('noindex'));
        });
    } finally {
        await t.close();
    }
    done();
})();
