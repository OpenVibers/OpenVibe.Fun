'use strict';
/**
 * Chat votes are read, never posted. One public page of a channel's history creates at most one vote, suggestion,
 * check or plan vote per message id; a re-read changes nothing. The commands are the ones the pages document:
 * !quest vote, !quest suggest, !quest verify, !plan vote. A deleted message and an unsafe suggestion are skipped.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { parseCommand } = require('../server/chat-sync');

(async () => {
    await check('the command parser accepts only the documented, bounded forms', async () => {
        assert.deepStrictEqual(parseCommand('!quest vote find-the-best-bench', 'kim'), { kind: 'quest', verb: 'vote', slug: 'find-the-best-bench' });
        assert.deepStrictEqual(parseCommand('!plan vote friday-plan 2', 'kim'), { kind: 'plan', verb: 'vote', slug: 'friday-plan', position: 2 });
        assert.strictEqual(parseCommand('!plan vote friday-plan 11', 'kim'), null);
        assert.strictEqual(parseCommand('!quest suggest', 'kim'), null);
        assert.strictEqual(parseCommand('hello', 'kim'), null);
        assert.strictEqual(parseCommand('!quest vote find-the-best-bench', ''), null);
    });

    const t = await boot();
    try {
        const ada = t.network.addUser('ada');
        const kim = t.network.addUser('kim');
        let board = null;
        let quest = null;
        await check('a first read creates the chat vote and the chat suggestion', async () => {
            const b = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Chat board' } });
            assert.strictEqual(b.status, 201);
            board = b.json();
            const s = await t.get(`/api/v1/quests/boards/${board.id}/suggest`, { as: kim, json: { title: 'Find the best bench', brief: 'Walk ten minutes.' } });
            assert.strictEqual(s.status, 201);
            quest = s.json();
            assert.strictEqual(quest.slug, 'find-the-best-bench');
            const out = await t.ctx.chatSync.runOnce();
            assert.strictEqual(out.channels, 1);
            assert.strictEqual(out.votes, 1);
            assert.strictEqual(out.suggestions, 1);
            assert.strictEqual(out.checks, 0, 'the check arrived before the quest was completed');
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quest_votes WHERE quest_id = $1', [quest.id])), 1);
            const mural = await t.ctx.s.db.maybe("SELECT * FROM fun_quests WHERE title = 'Find a mural nobody has shown chat'");
            assert.ok(mural, 'the chat suggestion was stored');
            assert.strictEqual(mural.source, 'chat');
            assert.match(mural.chat_author, /^[0-9a-f]{32}$/);
            assert.ok(!mural.chat_author.includes('bo'), 'the public chat username is hashed, not copied');
            assert.strictEqual(mural.visibility, 'unlisted');
            assert.strictEqual(Number(await t.ctx.s.db.value("SELECT COUNT(*)::int FROM fun_chat_seen")), 4);
        });

        await check('a second read of the same page adds nothing', async () => {
            const out = await t.ctx.chatSync.runOnce();
            assert.strictEqual(out.messages, 0);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quest_votes WHERE quest_id = $1', [quest.id])), 1);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quests WHERE board_id = $1', [board.id])), 2);
        });

        await check('three distinct chat verifications make the chat quorum and the streamer can verify', async () => {
            await t.get(`/api/v1/quests/${quest.slug}/accept`, { as: ada, json: {} });
            await t.get(`/api/v1/quests/${quest.slug}/live`, { as: ada, json: {} });
            await t.get(`/api/v1/quests/${quest.slug}/complete`, { as: ada, json: {} });
            for (const [i, name] of ['zoe', 'li', 'max'].entries()) {
                t.upstreams.addMessage({ id: 200 + i, username: name, channel: 'ada', message: `!quest verify ${quest.slug}`, is_deleted: 0, timestamp: '2026-10-28 11:00:00' });
                const out = await t.ctx.chatSync.runOnce();
                assert.strictEqual(out.checks, 1, JSON.stringify(out));
            }
            const v = await t.get(`/api/v1/quests/${quest.slug}/verify`, { as: ada, json: { via: 'chat' } });
            assert.strictEqual(v.status, 200, v.text);
            assert.strictEqual(v.json().verification, 'chat');
        });

        await check('a plan chat vote is one per public chat username and is idempotent', async () => {
            const future = new Date(Date.now() + 172_800_000).toISOString();
            const p = await t.get('/api/v1/plans', { as: kim, json: { title: 'Friday plan', starts_at: future, timezone: 'UTC', visibility: 'public', chat_username: 'ada', options: [{ title: 'Mural walk' }, { title: 'Bowling' }] } });
            assert.strictEqual(p.status, 201, p.text);
            const plan = p.json();
            t.upstreams.addMessage({ id: 300, username: 'bo', channel: 'ada', message: `!plan vote ${plan.slug} 2`, is_deleted: 0, timestamp: '2026-10-28 11:10:00' });
            const out = await t.ctx.chatSync.runOnce();
            assert.strictEqual(out.planVotes, 1, JSON.stringify(out));
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_plan_votes WHERE plan_id = $1', [plan.id])), 1);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT position FROM fun_plan_options WHERE id = (SELECT option_id FROM fun_plan_votes WHERE plan_id = $1)', [plan.id])), 2);
            const again = await t.ctx.chatSync.runOnce();
            assert.strictEqual(again.messages, 0);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_plan_votes WHERE plan_id = $1', [plan.id])), 1);
        });

        await check('an unsafe or deleted chat suggestion writes no quest', async () => {
            const before = Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quests'));
            t.upstreams.addMessage({ id: 400, username: 'bo', channel: 'ada', message: '!quest suggest climb a bridge and jump off', is_deleted: 0, timestamp: '2026-10-28 11:20:00' });
            t.upstreams.addMessage({ id: 401, username: 'bo', channel: 'ada', message: '!quest suggest steal a sign from the bar', is_deleted: 1, timestamp: '2026-10-28 11:21:00' });
            await t.ctx.chatSync.runOnce();
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_quests')), before);
        });
    } finally {
        await t.close();
    }
    done();
})();
