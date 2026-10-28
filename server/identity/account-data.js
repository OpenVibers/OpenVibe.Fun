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
        note: 'A verified IRL quest and a shared group plan stay as the community\'s record with your name removed; your votes, checks, badges, rewards and reports are erased.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
