'use strict';
/**
 * ADR-033: Fun's part of an account export and deletion, applied through /internal/events with a stand-in Network.
 * A person's boards, suggestions, votes, checks, badges, rewards, plans, options, plan votes and reports are
 * exported. On deletion the personal rows are erased; a public quest/board and a shared plan stay as the
 * community's record with the subject column NULL. Another person's rows are untouched. A redelivery changes
 * nothing; a bad signature and a proxied request are refused.
 */
const assert = require('assert');
const http = require('http');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createNetworkSender, uncovered } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { TABLES } = require('../server/identity/account-data');
const { testDb } = require('./helpers/db');

const A = ids.newId('user');
const B = ids.newId('user');
const EXP = `exp_${ids.ulid()}`;
const DEL = `del_${ids.ulid()}`;
const SECRET = `fixture_${'account'.repeat(6)}`;
const WRONG = `fixture_${'mismatch'.repeat(6)}`;

const exportEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.export_requested', source: 'network', payload: { export_id: EXP, subject: A } };
const deleteEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.deleted', source: 'network', payload: { deletion_id: DEL, subject: A, aliases: [] } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

async function startNetworkStub() {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_fun', token_type: 'Bearer', expires_in: 300 });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw.toString() || 'null') });
            return json(201, {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
    await check('every table that names a person is covered or exempted with a reason', async () => {
        const d = await testDb();
        try {
            const missing = await uncovered(d.db, {
                tables: TABLES,
                exempt: {account_data_events: 'the ledger of requests itself: which export and deletion fun applied'},
            });
            assert.deepStrictEqual(missing, [], `a table with a person column is neither covered nor exempted: ${missing.join(', ')}`);
        } finally { await d.close(); }
    });

    const stub = await startNetworkStub();
    const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'fun', clientSecret: 'fun-secret' });
    const t = await boot({ env: { FUN_EVENTS_SECRET: SECRET }, accountSend: sender });
    const db = t.ctx.s.db;
    const boardA = `qbd_${ids.ulid()}`;
    const boardB = `qbd_${ids.ulid()}`;
    const questA = `qst_${ids.ulid()}`;
    const questB = `qst_${ids.ulid()}`;
    const planA = `pln_${ids.ulid()}`;
    const planB = `pln_${ids.ulid()}`;
    const optA = `pop_${ids.ulid()}`;
    const optB = `pop_${ids.ulid()}`;
    try {
        const close = new Date(Date.now() + 7_200_000).toISOString();
        const start = new Date(Date.now() + 172_800_000).toISOString();
        const voteClose = new Date(Date.now() + 169_200_000).toISOString();
        await db.exec(
            `INSERT INTO fun_quest_boards (id, streamer_subject, live_username, chat_username, title, closes_at)
             VALUES ($1, $2, 'ada', 'ada', 'A board', $4::timestamptz), ($3, $5, 'bo', 'bo', 'B board', $4::timestamptz)`,
            [boardA, A, boardB, close, B]);
        await db.exec(
            `INSERT INTO fun_quests (id, board_id, slug, title, brief, category, source, streamer_username, chat_username, stream_url, created_by)
             VALUES ($1, $2, 'a-quest', 'A quest', 'A brief', 'chill', 'suggestion', 'ada', 'ada', 'https://openvibe.live/@ada', $3),
                    ($4, $5, 'b-quest', 'B quest', 'B brief', 'chill', 'suggestion', 'bo', 'bo', 'https://openvibe.live/@bo', $6)`,
            [questA, boardA, A, questB, boardB, B]);
        await db.exec(
            `INSERT INTO fun_quest_votes (quest_id, voter, subject) VALUES ($1, $2, $2), ($1, $3, $3)`,
            [questA, A, B]);
        await db.exec(
            `INSERT INTO fun_quest_checks (quest_id, voter, subject, via) VALUES ($1, 'chat:zoe', $2, 'chat'), ($1, 'staff:b', $3, 'moderator')`,
            [questA, A, B]);
        await db.exec(
            `INSERT INTO fun_badges (quest_id, subject, badge_id, name) VALUES ($1, $2, 'fun_irl_a', 'IRL quest: A quest'), ($1, $3, 'fun_irl_b', 'IRL quest: B badge')`,
            [questA, A, B]);
        const rewardA = `qrw_${ids.ulid()}`;
        await db.exec(
            `INSERT INTO fun_quest_rewards (id, quest_id, subject, coins, state) VALUES ($1, $2, $3, 25, 'skipped'), ($4, $2, $5, 25, 'skipped')`,
            [rewardA, questA, A, `qrw_${ids.ulid()}`, B]);
        await db.exec(
            `INSERT INTO fun_plans (id, slug, owner_subject, owner_username, title, starts_at, closes_at, visibility)
             VALUES ($1, 'a-plan', $2, 'ada', 'A plan', $4::timestamptz, $5::timestamptz, 'unlisted'),
                    ($3, 'b-plan', $6, 'bo', 'B plan', $4::timestamptz, $5::timestamptz, 'unlisted')`,
            [planA, A, planB, start, voteClose, B]);
        await db.exec(
            `INSERT INTO fun_plan_options (id, plan_id, title, created_by, position) VALUES ($1, $2, 'A option', $3, 1), ($4, $5, 'B option', $6, 1)`,
            [optA, planA, A, optB, planB, B]);
        await db.exec(
            `INSERT INTO fun_plan_votes (plan_id, voter, subject, option_id) VALUES ($1, $2, $2, $3), ($1, $4, $4, $3)`,
            [planA, A, optA, B]);
        const repA = `frp_${ids.ulid()}`;
        const repB = `frp_${ids.ulid()}`;
        await db.exec(
            `INSERT INTO fun_reports (id, target_kind, target_id, subject, kind, reason) VALUES ($1, 'quest', $3, $4, 'safety', 'A report'), ($2, 'quest', $3, $5, 'safety', 'B report')`,
            [repA, repB, questA, A, B]);

        await check('an export carries only A\'s rows', async () => {
            const res = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(exportEvent), SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'exported');
            const part = stub.calls.find((c) => c.url === `/internal/account-exports/${EXP}/parts`);
            assert.ok(part, 'the part was pushed to Network');
            assert.strictEqual(part.auth, 'Bearer tok_fun');
            assert.strictEqual(part.body.subject, A);
            const names = part.body.files.map((f) => f.name).sort();
            for (const name of ['quest-boards.json', 'quest-suggestions.json', 'quest-votes.json', 'quest-checks.json', 'badges.json', 'rewards.json', 'plans.json', 'plan-options.json', 'plan-votes.json', 'reports.json']) assert.ok(names.includes(name), `${name}: ${names.join(',')}`);
            const all = JSON.stringify(part.body);
            assert.ok(all.includes('A quest'));
            assert.ok(!all.includes('B quest'), 'nobody else\'s quest');
            assert.ok(all.includes('A plan'));
            assert.ok(!all.includes('B plan'), 'nobody else\'s plan');
            assert.ok(all.includes('A report'));
            assert.ok(!all.includes('B report'));
        });

        await check('a deletion erases A\'s personal rows, anonymizes the community records and leaves B alone', async () => {
            const res = await t.get('/internal/events', { method: 'POST', body: bodyOf(deleteEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(deleteEvent), SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'erased');
            for (const [table, column] of [['fun_quest_votes', 'subject'], ['fun_quest_checks', 'subject'], ['fun_badges', 'subject'], ['fun_quest_rewards', 'subject'], ['fun_plan_votes', 'subject'], ['fun_reports', 'subject']]) {
                assert.strictEqual(Number(await db.value(`SELECT COUNT(*)::int FROM ${table} WHERE ${column} = $1`, [A])), 0, table);
                assert.ok(Number(await db.value(`SELECT COUNT(*)::int FROM ${table} WHERE ${column} = $1`, [B])) >= 1, `${table} keeps B`);
            }
            assert.strictEqual(await db.value('SELECT streamer_subject FROM fun_quest_boards WHERE id = $1', [boardA]), null);
            assert.strictEqual(await db.value('SELECT created_by FROM fun_quests WHERE id = $1', [questA]), null);
            assert.strictEqual(await db.value('SELECT owner_subject FROM fun_plans WHERE id = $1', [planA]), null);
            assert.strictEqual(await db.value('SELECT owner_username FROM fun_plans WHERE id = $1', [planA]), null);
            assert.strictEqual(await db.value('SELECT created_by FROM fun_plan_options WHERE id = $1', [optA]), null);
            assert.strictEqual(await db.value('SELECT streamer_subject FROM fun_quest_boards WHERE id = $1', [boardB]), B);
            assert.strictEqual(await db.value('SELECT created_by FROM fun_quests WHERE id = $1', [questB]), B);
            assert.strictEqual(await db.value('SELECT owner_subject FROM fun_plans WHERE id = $1', [planB]), B);
            const confirmation = stub.calls.find((c) => c.url === `/internal/account-deletions/${DEL}/confirmations`);
            assert.ok(confirmation, 'the confirmation was sent');
            assert.ok(Number(confirmation.body.erased.fun_quest_votes) >= 1);
            assert.ok(Number(confirmation.body.erased.fun_plan_votes) >= 1);
            assert.ok(!Number.isNaN(Date.parse(confirmation.body.completed_at)));
        });

        await check('a redelivery changes nothing', async () => {
            const res = await t.get('/internal/events', { method: 'POST', body: bodyOf(deleteEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(deleteEvent), SECRET) } });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'unchanged');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int FROM fun_quest_boards WHERE id = $1', [boardA])), 1);
        });

        await check('the internal route refuses a bad signature (401) and a forwarded request (403)', async () => {
            const bad = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(bodyOf(exportEvent), WRONG) } });
            assert.strictEqual(bad.status, 401);
            const forwarded = await t.get('/internal/events', { method: 'POST', body: bodyOf(exportEvent), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...signDeliveryHeaders(bodyOf(exportEvent), SECRET) } });
            assert.strictEqual(forwarded.status, 403);
        });
    } finally {
        await t.close();
        await stub.close();
    }
    done();
})();
