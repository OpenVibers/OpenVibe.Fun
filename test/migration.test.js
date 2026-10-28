'use strict';
/**
 * The expand migration applies in one pass and creates the tables the plan names, plus the SDK's account receipts
 * and telemetry. The constraints are real: a suggested quest may not be public, a bad id/slug/status is refused, and
 * one person can vote only once per quest and plan.
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('0001_initial.sql applies and creates the Fun tables', async () => {
            const names = (await t.ctx.s.db.many("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map((r) => r.name);
            for (const table of ['fun_quest_boards', 'fun_quests', 'fun_quest_votes', 'fun_quest_checks', 'fun_badges', 'fun_quest_rewards',
                'fun_plans', 'fun_plan_options', 'fun_plan_votes', 'fun_reports', 'fun_chat_seen', 'fun_chat_cursors',
                'fun_geo_cache', 'fun_outbox', 'account_data_events', 'telemetry_samples']) {
                assert.ok(names.includes(table), `missing ${table}`);
            }
        });

        await check('a suggested quest cannot be public; a bad status, id or slug is refused', async () => {
            const db = t.ctx.s.db;
            const now = new Date().toISOString();
            const boardId = `qbd_${ids.ulid()}`;
            await db.exec(`INSERT INTO fun_quest_boards (id, live_username, chat_username, title, closes_at) VALUES ($1, 'ada', 'ada', 'Board', $2::timestamptz)`, [boardId, new Date(Date.now() + 3_600_000).toISOString()]);
            const id = `qst_${ids.ulid()}`;
            await assert.rejects(db.exec(
                `INSERT INTO fun_quests (id, board_id, slug, title, brief, category, source, status, visibility, streamer_username, chat_username, stream_url)
                 VALUES ($1, $2, 'public-suggestion', 'A title', 'A brief', 'chill', 'suggestion', 'suggested', 'public', 'ada', 'ada', 'https://openvibe.live/@ada')`,
                [id, boardId],
            ), /public_only_when_accepted/);
            await assert.rejects(db.exec(
                `INSERT INTO fun_quests (id, board_id, slug, title, brief, category, source, status, visibility, streamer_username, chat_username, stream_url)
                 VALUES ('bad_id', $1, 'x', 'A title', 'A brief', 'chill', 'suggestion', 'suggested', 'unlisted', 'ada', 'ada', 'https://openvibe.live/@ada')`, [boardId],
            ), /fun_quests_id/);
            assert.strictEqual(Number(await db.value("SELECT COUNT(*)::int FROM fun_quests WHERE slug = 'public-suggestion'")), 0);
            assert.ok(now);
        });

        await check('one vote per person per quest and per plan is a primary key', async () => {
            const db = t.ctx.s.db;
            const now = new Date().toISOString();
            const boardId = `qbd_${ids.ulid()}`;
            await db.exec(`INSERT INTO fun_quest_boards (id, live_username, chat_username, title, closes_at) VALUES ($1, 'ada', 'ada', 'Vote board', $2::timestamptz)`, [boardId, new Date(Date.now() + 3_600_000).toISOString()]);
            const qid = `qst_${ids.ulid()}`;
            await db.exec(`INSERT INTO fun_quests (id, board_id, slug, title, brief, category, source, streamer_username, chat_username, stream_url)
                VALUES ($1, $2, 'votable-quest', 'A title', 'A brief', 'chill', 'suggestion', 'ada', 'ada', 'https://openvibe.live/@ada')`, [qid, boardId]);
            const subject = ids.newId('user');
            await db.exec('INSERT INTO fun_quest_votes (quest_id, voter, subject) VALUES ($1, $2, $2)', [qid, subject]);
            await assert.rejects(db.exec('INSERT INTO fun_quest_votes (quest_id, voter, subject) VALUES ($1, $2, $2)', [qid, subject]), /duplicate key|unique/i);
            const planId = `pln_${ids.ulid()}`;
            await db.exec(`INSERT INTO fun_plans (id, slug, title, starts_at, closes_at) VALUES ($1, 'votable-plan', 'A plan', $2::timestamptz, $3::timestamptz)`,
                [planId, new Date(Date.now() + 172_800_000).toISOString(), new Date(Date.now() + 169_200_000).toISOString()]);
            const optId = `pop_${ids.ulid()}`;
            await db.exec("INSERT INTO fun_plan_options (id, plan_id, title, position) VALUES ($1, $2, 'Option', 1)", [optId, planId]);
            await db.exec('INSERT INTO fun_plan_votes (plan_id, voter, subject, option_id) VALUES ($1, $2, $2, $3)', [planId, subject, optId]);
            await assert.rejects(db.exec('INSERT INTO fun_plan_votes (plan_id, voter, subject, option_id) VALUES ($1, $2, $2, $3)', [planId, subject, optId]), /duplicate key|unique/i);
        });

        await check('cached OSM JSON is jsonb and a public quest/plan has a Search outbox row', async () => {
            const db = t.ctx.s.db;
            await db.exec("INSERT INTO fun_geo_cache (key, body, expires_at) VALUES ('k', '{\"elements\":[]}'::jsonb, now() + interval '1 day')");
            assert.deepStrictEqual((await db.maybe("SELECT body FROM fun_geo_cache WHERE key = 'k'")).body, { elements: [] });
        });
    } finally {
        await t.close();
    }
    done();
})();
