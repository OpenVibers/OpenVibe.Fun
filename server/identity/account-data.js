'use strict';

/**
 * Account export and deletion → Fun (ADR-033; openvibe-sdk/account-data).
 *
 * A person's own rows: board, suggestions, votes, verification checks, badges, OpenCoin reward ledger, group plans
 * they started, plan options they proposed, their plan votes and the reports they filed.
 *
 * A public quest or a shared group plan is the community's record, not only one person's row: on deletion the
 * owner/subject column becomes NULL (the authorless record stays) and every personal row is deleted. That is why
 * fun_quests/fun_quest_boards/fun_plans/fun_plan_options are anonymize, while votes, checks, badges, rewards and
 * reports are delete. No table holds a token. A chat vote/suggestion is keyed by a one-way hash of the public chat
 * username, not a Network subject, so it has no account to export or erase.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'fun_quest_boards', subject: 'streamer_subject', file: 'quest-boards.json', erase: { anonymize: {} } },
    { table: 'fun_quests', subject: 'created_by', file: 'quest-suggestions.json', erase: { anonymize: {} } },
    { table: 'fun_quest_votes', subject: 'subject', file: 'quest-votes.json', erase: 'delete' },
    { table: 'fun_quest_checks', subject: 'subject', file: 'quest-checks.json', erase: 'delete' },
    { table: 'fun_badges', subject: 'subject', file: 'badges.json', erase: 'delete' },
    { table: 'fun_quest_rewards', subject: 'subject', file: 'rewards.json', erase: 'delete' },
    { table: 'fun_plans', subject: 'owner_subject', file: 'plans.json', erase: { anonymize: { owner_username: null } } },
    { table: 'fun_plan_options', subject: 'created_by', file: 'plan-options.json', erase: { anonymize: {} } },
    { table: 'fun_plan_votes', subject: 'subject', file: 'plan-votes.json', erase: 'delete' },
    { table: 'fun_reports', subject: 'subject', file: 'reports.json', erase: 'delete' },
];

function create({ db, log = console } = {}) {
    return createAccountData({
        db,
        service: 'fun',
        tables: TABLES,
        /**
         * The sharing rows (design 2026-11-06, step 6) name their owner and members by canonical subject. The item
         * stays as the community's record with its name removed; its share row and the person's memberships go, and
         * the read paths fall back to the old column (which stays public/unlisted). Children first.
         */
        extraErase: async (t, subjects) => {
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                await t.exec("DELETE FROM share_members WHERE service='fun' AND subject->>'id' = $1", [id]);
                await t.exec("DELETE FROM share_transfers WHERE service='fun' AND (from_subject->>'id' = $1 OR to_subject->>'id' = $1)", [id]);
                await t.exec("DELETE FROM share_access_requests WHERE service='fun' AND subject->>'id' = $1", [id]);
            }
            for (const subject of subjects) {
                const id = String(subject).replace(/^user:/, '');
                const owned = await t.many("SELECT kind, resource_id FROM shares WHERE service='fun' AND owner_subject->>'id' = $1", [id]);
                for (const row of owned) {
                    await t.exec("DELETE FROM share_members WHERE service='fun' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_transfers WHERE service='fun' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM share_access_requests WHERE service='fun' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                    await t.exec("DELETE FROM shares WHERE service='fun' AND kind=$1 AND resource_id=$2", [row.kind, row.resource_id]);
                }
            }
        },
        note: 'A verified IRL quest and a shared group plan stay as the community\'s record with your name removed; your votes, checks, badges, rewards and reports are erased.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
