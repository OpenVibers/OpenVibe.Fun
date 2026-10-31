'use strict';

/**
 * Fun's data: IRL quest boards and suggestions, their votes and chat checks, badges and reward ledger; group plans
 * with options and votes; reports; the OSM/Ticketmaster cache; and the Search outbox.
 *
 * Every write that makes a public quest or plan writes its Search document (or tombstone) in the same transaction
 * (server/search.js). A suggestion is born unlisted and only the streamer (or staff) can accept it; a plan's owner
 * (or staff) decides its winner. No function here stores a token or a private message.
 */
const crypto = require('crypto');
const { ids } = require('openvibe-contracts');
const safety = require('./quests/safety');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const QUEST_STATUSES = Object.freeze(['suggested', 'accepted', 'live', 'completed', 'verified', 'rejected', 'hidden']);
const PUBLIC_QUEST_STATUSES = Object.freeze(['accepted', 'live', 'completed', 'verified']);
const VISIBILITIES = Object.freeze(['public', 'unlisted', 'hidden']);
const PLAN_STATUSES = Object.freeze(['voting', 'decided', 'cancelled']);
const REPORT_KINDS = Object.freeze(['safety', 'spam', 'other']);

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const num = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const clean = (v, max = 1000) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** A chat voter is a one-way key, not the public username: distinct, idempotent and not a new copy of the name. */
const chatVoter = (username) => `chat:${crypto.createHash('sha256').update(`fun-chat:${String(username)}`).digest('hex').slice(0, 32)}`;
const refusal = (status, code, message, field) => ({ ok: false, status, code, message, ...(field ? { field } : {}) });

function wireBoard(row) {
    if (!row) return null;
    return {
        id: row.id, title: row.title, live_username: row.live_username, chat_username: row.chat_username,
        city: row.city || null, lat: num(row.lat), lon: num(row.lon),
        accessible_only: Boolean(row.accessible_only), max_suggestions: Number(row.max_suggestions) || 30,
        status: row.status, accepted_quest_id: row.accepted_quest_id || null,
        opens_at: iso(row.opens_at), closes_at: iso(row.closes_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    };
}

function wireQuest(row, extra = {}) {
    if (!row) return null;
    return {
        id: row.id, slug: row.slug, board_id: row.board_id, title: row.title, brief: row.brief,
        category: row.category, source: row.source, status: row.status, visibility: row.visibility,
        city: row.city || null, lat: num(row.lat), lon: num(row.lon), place_name: row.place_name || null,
        accessible: Boolean(row.accessible), streamer_username: row.streamer_username, stream_url: row.stream_url,
        revision: Number(row.revision) || 1,
        accepted_at: iso(row.accepted_at), completed_at: iso(row.completed_at), verified_at: iso(row.verified_at),
        verification: row.verification || null, reward_badge: row.reward_badge || null, reward_coins: Number(row.reward_coins) || 0,
        created_at: iso(row.created_at), updated_at: iso(row.updated_at),
        ...extra,
    };
}

function wirePlan(row, extra = {}) {
    if (!row) return null;
    return {
        id: row.id, slug: row.slug, title: row.title, summary: row.summary || null,
        city: row.city || null, lat: num(row.lat), lon: num(row.lon),
        timezone: row.timezone, starts_at: iso(row.starts_at), closes_at: iso(row.closes_at),
        status: row.status, winner_option_id: row.winner_option_id || null, visibility: row.visibility,
        chat_username: row.chat_username || null, owner_username: row.owner_username || null,
        revision: Number(row.revision) || 1, created_at: iso(row.created_at), updated_at: iso(row.updated_at),
        ...extra,
    };
}

function wireOption(row, extra = {}) {
    if (!row) return null;
    return {
        id: row.id, plan_id: row.plan_id, title: row.title, details: row.details || null,
        place_name: row.place_name || null, lat: num(row.lat), lon: num(row.lon),
        accessible: Boolean(row.accessible), price_note: row.price_note || null,
        starts_at: iso(row.starts_at), position: Number(row.position) || 1, created_at: iso(row.created_at),
        ...extra,
    };
}

function wireReport(row) {
    if (!row) return null;
    return {
        id: row.id, target_kind: row.target_kind, target_id: row.target_id,
        kind: row.kind, reason: row.reason, note: row.note || null, status: row.status,
        created_at: iso(row.created_at), handled_at: iso(row.handled_at), handled_by: row.handled_by || null,
        ...(row.target_title ? { target_title: row.target_title } : {}),
        ...(row.target_slug ? { target_slug: row.target_slug } : {}),
    };
}

function validTimezone(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true; } catch { return false; }
}

function parseWhen(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v !== 'string' || !v.trim()) return null;
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
}

function createStore(s, { search = { sync: async () => null }, config = {} } = {}) {
    const db = s.db;
    const q = (t) => t || db;
    const questConfig = config.quests || {};

    async function byQuestSlug(slug, t) {
        return await q(t).maybe('SELECT * FROM fun_quests WHERE slug = $1', [String(slug || '')]);
    }
    async function byQuestId(id, t) {
        return await q(t).maybe('SELECT * FROM fun_quests WHERE id = $1', [String(id || '')]);
    }
    async function boardById(id, t) {
        return await q(t).maybe('SELECT * FROM fun_quest_boards WHERE id = $1', [String(id || '')]);
    }
    async function planBySlug(slug, t) {
        return await q(t).maybe('SELECT * FROM fun_plans WHERE slug = $1', [String(slug || '')]);
    }
    async function planById(id, t) {
        return await q(t).maybe('SELECT * FROM fun_plans WHERE id = $1', [String(id || '')]);
    }

    async function uniqueSlug(base, t) {
        const root = String(base || 'fun').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 65) || 'fun';
        let slug = root;
        for (let i = 2; i < 200; i++) {
            const found = await q(t).maybe('SELECT id FROM fun_quests WHERE slug = $1 UNION ALL SELECT id FROM fun_plans WHERE slug = $1', [slug]);
            if (!found) return slug;
            slug = `${root}-${i}`;
        }
        return `${root}-${Date.now().toString(36)}`;
    }

    async function voteCounts(questIds, t) {
        const out = {};
        const wanted = [...new Set((questIds || []).filter(Boolean))];
        if (!wanted.length) return out;
        const rows = await q(t).many('SELECT quest_id, COUNT(*)::int AS n FROM fun_quest_votes WHERE quest_id = ANY($1::text[]) GROUP BY quest_id', [wanted]);
        for (const row of rows) out[row.quest_id] = Number(row.n) || 0;
        return out;
    }

    async function countsForQuest(id, t) {
        const row = await q(t).maybe(
            `SELECT (SELECT COUNT(*)::int FROM fun_quest_votes WHERE quest_id = $1) AS votes,
                    (SELECT COUNT(*)::int FROM fun_quest_checks WHERE quest_id = $1) AS checks`, [id]);
        return { votes: Number(row && row.votes) || 0, checks: Number(row && row.checks) || 0 };
    }

    // ── Quest boards and suggestions ─────────────────────────
    async function createBoard({ streamerSubject, title, liveUsername, chatUsername, city = null, lat = null, lon = null, accessibleOnly = false, maxSuggestions = null, closesAt = null }) {
        if (!SUBJECT_RE.test(String(streamerSubject || ''))) return refusal(403, 'fun.person_required', 'A board belongs to a signed-in person.');
        if (!USERNAME_RE.test(String(liveUsername || ''))) return refusal(400, 'fun.quest.invalid', 'live_username is required', 'live_username');
        if (!USERNAME_RE.test(String(chatUsername || ''))) return refusal(400, 'fun.quest.invalid', 'chat_username is required', 'chat_username');
        const t = clean(title, 120);
        if (t.length < 3 || t.length > 120) return refusal(400, 'fun.quest.invalid', 'title must be 3 to 120 characters', 'title');
        const cityName = city == null || city === '' ? null : clean(city, 120);
        if (cityName !== null && !cityName) return refusal(400, 'fun.quest.invalid', 'city must be 1 to 120 characters', 'city');
        const la = num(lat); const lo = num(lon);
        if (la != null && (la < -90 || la > 90)) return refusal(400, 'fun.quest.invalid', 'lat must be -90 to 90', 'lat');
        if (lo != null && (lo < -180 || lo > 180)) return refusal(400, 'fun.quest.invalid', 'lon must be -180 to 180', 'lon');
        const close = closesAt ? parseWhen(closesAt) : new Date(s.now() + 4 * 60 * 60_000);
        if (!close || close.getTime() <= s.now() + 60_000) return refusal(400, 'fun.quest.invalid', 'closes_at must be in the future', 'closes_at');
        const max = Math.min(100, Math.max(1, Number(maxSuggestions) || questConfig.maxSuggestions || 30));
        const id = s.newId('qbd');
        const row = await db.maybe(
            `INSERT INTO fun_quest_boards (id, streamer_subject, live_username, chat_username, title, city, lat, lon, accessible_only, max_suggestions, status, opens_at, closes_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', now(), $11::timestamptz) RETURNING *`,
            [id, streamerSubject, String(liveUsername), String(chatUsername), t, cityName, la, lo, Boolean(accessibleOnly), max, close.toISOString()],
        );
        return { ok: true, board: wireBoard(row) };
    }

    async function boardForSubject(subject) {
        const rows = await db.many('SELECT * FROM fun_quest_boards WHERE streamer_subject = $1 ORDER BY created_at DESC LIMIT 50', [subject]);
        return rows.map(wireBoard);
    }

    async function boardPage(id) {
        const board = await boardById(id);
        if (!board) return null;
        const rows = await db.many('SELECT * FROM fun_quests WHERE board_id = $1 ORDER BY created_at ASC', [id]);
        const counts = await voteCounts(rows.map((r) => r.id));
        return {
            board: wireBoard(board),
            quests: rows.map((r) => wireQuest(r, { votes: counts[r.id] || 0 })),
        };
    }

    async function questsForSubject(subject) {
        const rows = await db.many(
            `SELECT q.* FROM fun_quests q JOIN fun_quest_boards b ON b.id = q.board_id
             WHERE b.streamer_subject = $1 ORDER BY q.created_at DESC LIMIT 40`, [subject]);
        const counts = await voteCounts(rows.map((r) => r.id));
        return rows.map((r) => wireQuest(r, { votes: counts[r.id] || 0 }));
    }

    async function openBoardsForChat(chatUsername) {
        const rows = await db.many("SELECT * FROM fun_quest_boards WHERE status = 'open' AND closes_at > now() AND lower(chat_username) = lower($1) ORDER BY created_at ASC LIMIT 20", [String(chatUsername || '')]);
        return rows.map(wireBoard);
    }

    async function createSuggestion({ boardId, subject = null, chatUsername = null, title, brief = null, category = 'near_me', placeName = null, lat = null, lon = null, accessible = false, source = 'suggestion' }) {
        const checked = safety.checkSuggestion({ title, brief: brief || title });
        if (!checked.ok) return checked;
        const cat = safety.checkCategory(category);
        if (!cat.ok) return cat;
        if (!['suggestion', 'chat', 'idea', 'streamer'].includes(source)) return refusal(400, 'fun.quest.invalid', 'source is not one of suggestion, chat, idea, streamer', 'source');
        const la = num(lat); const lo = num(lon);
        if (la != null && (la < -90 || la > 90)) return refusal(400, 'fun.quest.invalid', 'lat must be -90 to 90', 'lat');
        if (lo != null && (lo < -180 || lo > 180)) return refusal(400, 'fun.quest.invalid', 'lon must be -180 to 180', 'lon');
        return await s.tx(async (t) => {
            const board = await boardById(boardId, t);
            if (!board) return refusal(404, 'fun.board_not_found', 'No such quest board.');
            if (board.status !== 'open') return refusal(409, 'fun.board_closed', 'This board is closed.');
            if (new Date(board.closes_at).getTime() <= s.now()) return refusal(409, 'fun.board_closed', 'This board has closed.');
            const n = Number(await t.value('SELECT COUNT(*)::int AS n FROM fun_quests WHERE board_id = $1', [board.id])) || 0;
            if (n >= Number(board.max_suggestions)) return refusal(409, 'fun.board_full', 'This board has all the suggestions it takes.');
            if (board.accessible_only && !accessible) return refusal(422, 'fun.quest.accessible_only', 'This board only takes accessible activities.', 'accessible');
            if (source === 'chat' && !USERNAME_RE.test(String(chatUsername || ''))) return refusal(400, 'fun.quest.invalid', 'a chat suggestion needs its public username', 'chat_username');
            const slug = await uniqueSlug(checked.title, t);
            const id = s.newId('qst');
            const row = await t.maybe(
                `INSERT INTO fun_quests (id, board_id, slug, title, brief, category, source, status, visibility, city, lat, lon, place_name, accessible,
                    streamer_username, chat_username, stream_url, created_by, chat_author, revision, reward_coins)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'suggested', 'unlisted', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, 0) RETURNING *`,
                [id, board.id, slug, checked.title, checked.brief, cat.value, source, board.city || null, la == null ? board.lat : la,
                    lo == null ? board.lon : lo, placeName ? clean(placeName, 200) : null, Boolean(accessible),
                    board.live_username, board.chat_username, `https://openvibe.live/@${encodeURIComponent(board.live_username)}`,
                    subject && SUBJECT_RE.test(String(subject)) ? subject : null, chatUsername ? chatVoter(chatUsername).slice(5) : null],
            );
            return { ok: true, quest: wireQuest(row, { votes: 0 }) };
        });
    }

    async function castQuestVote({ slug, subject = null, chatUsername = null, via = 'web', chatMessageId = null }) {
        if (via !== 'web' && via !== 'chat') return refusal(400, 'fun.quest.invalid', 'via must be web or chat', 'via');
        const voter = via === 'chat'
            ? (chatUsername && USERNAME_RE.test(String(chatUsername)) ? chatVoter(chatUsername) : null)
            : (subject && SUBJECT_RE.test(String(subject)) ? subject : null);
        if (!voter) return refusal(403, 'fun.person_required', 'A vote needs a signed-in person or a public chat username.');
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest || quest.visibility === 'hidden' || quest.status === 'hidden' || quest.status === 'rejected') return refusal(404, 'fun.quest_not_found', 'No such quest.');
            if (quest.status === 'verified') return refusal(409, 'fun.quest_closed', 'A verified quest no longer takes votes.');
            await t.exec(
                `INSERT INTO fun_quest_votes (quest_id, voter, subject, via, chat_message_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, now(), now())
                 ON CONFLICT (quest_id, voter) DO UPDATE SET via = EXCLUDED.via, subject = EXCLUDED.subject,
                   chat_message_id = COALESCE(EXCLUDED.chat_message_id, fun_quest_votes.chat_message_id), updated_at = now()`,
                [quest.id, voter, via === 'web' ? subject : null, via, chatMessageId ? String(chatMessageId).slice(0, 80) : null],
            );
            const counts = await countsForQuest(quest.id, t);
            return { ok: true, quest_id: quest.id, slug: quest.slug, votes: counts.votes, voter };
        });
    }

    async function recordQuestCheck({ slug, subject = null, chatUsername = null, via = 'chat', chatMessageId = null }) {
        const voter = via === 'moderator' && subject ? `staff:${String(subject).slice(0, 64)}`
            : (via === 'chat' && chatUsername && USERNAME_RE.test(String(chatUsername)) ? chatVoter(chatUsername) : null);
        if (!voter) return refusal(403, 'fun.person_required', 'A verification check needs a moderator or a public chat username.');
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest) return refusal(404, 'fun.quest_not_found', 'No such quest.');
            if (quest.status !== 'completed' && quest.status !== 'verified') return refusal(409, 'fun.quest_not_completed', 'A quest is checked only after the streamer marks it completed.');
            await t.exec(
                `INSERT INTO fun_quest_checks (quest_id, voter, subject, via, chat_message_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (quest_id, voter) DO NOTHING`,
                [quest.id, voter, via === 'moderator' ? subject : null, via, chatMessageId ? String(chatMessageId).slice(0, 80) : null],
            );
            const checks = Number(await t.value('SELECT COUNT(*)::int FROM fun_quest_checks WHERE quest_id = $1', [quest.id])) || 0;
            return { ok: true, quest_id: quest.id, slug: quest.slug, checks };
        });
    }

    async function acceptQuest({ slug, subject, staff = false }) {
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest) return refusal(404, 'fun.quest_not_found', 'No such quest.');
            const board = await boardById(quest.board_id, t);
            if (!board) return refusal(404, 'fun.board_not_found', 'No such quest board.');
            if (!staff && board.streamer_subject !== subject) return refusal(403, 'fun.streamer_required', 'Only the streamer whose board this is can accept a quest.');
            if (quest.status === 'accepted' || quest.status === 'live' || quest.status === 'completed' || quest.status === 'verified') return { ok: true, quest: wireQuest(quest), unchanged: true };
            if (quest.status !== 'suggested') return refusal(409, 'fun.quest_closed', 'That quest cannot be accepted now.');
            if (board.status !== 'open') return refusal(409, 'fun.board_closed', 'This board is already closed.');
            const updated = await t.maybe(
                `UPDATE fun_quests SET status = 'accepted', visibility = 'public', accepted_at = now(), reward_coins = $2,
                   revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`,
                [quest.id, Number(questConfig.coins) || 0],
            );
            await t.exec("UPDATE fun_quests SET status = 'rejected', visibility = 'hidden', revision = revision + 1, updated_at = now() WHERE board_id = $1 AND id <> $2 AND status = 'suggested'", [board.id, quest.id]);
            await t.exec("UPDATE fun_quest_boards SET status = 'accepted', accepted_quest_id = $2, updated_at = now() WHERE id = $1", [board.id, quest.id]);
            const out = wireQuest(updated, { votes: (await countsForQuest(quest.id, t)).votes });
            await search.sync(t, 'quest', out);
            return { ok: true, quest: out, unchanged: false };
        });
    }

    async function setQuestStatus({ slug, subject, staff = false, to }) {
        if (!['live', 'completed'].includes(to)) return refusal(400, 'fun.quest.invalid', 'to must be live or completed');
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest) return refusal(404, 'fun.quest_not_found', 'No such quest.');
            const board = await boardById(quest.board_id, t);
            if (!staff && (!board || board.streamer_subject !== subject)) return refusal(403, 'fun.streamer_required', 'Only the streamer can change a quest\'s state.');
            const from = to === 'live' ? ['accepted'] : ['live'];
            if (!from.includes(quest.status)) return refusal(409, 'fun.quest_state', `A quest must be ${from.join(' or ')} before it can be ${to}.`);
            const updated = await t.maybe(
                `UPDATE fun_quests SET status = $2, ${to === 'completed' ? 'completed_at = now(),' : ''} revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`,
                [quest.id, to],
            );
            const out = wireQuest(updated, { votes: (await countsForQuest(quest.id, t)).votes });
            await search.sync(t, 'quest', out);
            return { ok: true, quest: out };
        });
    }

    async function verifyQuest({ slug, subject, staff = false, via = 'moderator' }) {
        if (!['chat', 'moderator'].includes(via)) return refusal(400, 'fun.quest.invalid', 'via must be chat or moderator', 'via');
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest) return refusal(404, 'fun.quest_not_found', 'No such quest.');
            const board = await boardById(quest.board_id, t);
            if (!staff && (!board || board.streamer_subject !== subject)) return refusal(403, 'fun.streamer_required', 'Only the streamer can verify this quest.');
            if (quest.status === 'verified') return { ok: true, quest: wireQuest(quest), unchanged: true };
            if (quest.status !== 'completed') return refusal(409, 'fun.quest_not_completed', 'The quest must be completed before it is verified.');
            if (via === 'moderator' && !staff) return refusal(403, 'fun.staff_required', 'A moderator verification needs a Network role global_mod or above.');
            const checks = Number(await t.value("SELECT COUNT(*)::int FROM fun_quest_checks WHERE quest_id = $1 AND via = 'chat'", [quest.id])) || 0;
            const quorum = Math.max(1, Number(questConfig.verifyVotes) || 3);
            if (via === 'chat' && checks < quorum) {
                return refusal(409, 'fun.quest_quorum', `The chat has ${checks} of ${quorum} verification votes.`);
            }
            if (via === 'moderator' && subject && SUBJECT_RE.test(String(subject))) {
                await t.exec("INSERT INTO fun_quest_checks (quest_id, voter, subject, via) VALUES ($1, $2, $3, 'moderator') ON CONFLICT (quest_id, voter) DO NOTHING", [quest.id, `staff:${String(subject).slice(0, 64)}`, subject]);
            }
            const badgeId = `fun_irl_${String(quest.slug).replace(/-/g, '_').slice(0, 40)}`;
            const badgeName = `IRL quest: ${quest.title}`.slice(0, 120);
            const streamer = board && board.streamer_subject ? board.streamer_subject : null;
            const reward = await t.maybe(
                `INSERT INTO fun_quest_rewards (id, quest_id, subject, coins, state, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'pending', now(), now()) ON CONFLICT (quest_id, subject) DO NOTHING RETURNING *`,
                [s.newId('qrw'), quest.id, streamer || subject, Number(quest.reward_coins) || 0],
            );
            if (streamer && SUBJECT_RE.test(String(streamer))) {
                await t.exec(
                    `INSERT INTO fun_badges (quest_id, subject, badge_id, name, awarded_at) VALUES ($1, $2, $3, $4, now())
                     ON CONFLICT (quest_id, subject) DO NOTHING`,
                    [quest.id, streamer, badgeId, badgeName],
                );
            }
            const updated = await t.maybe(
                `UPDATE fun_quests SET status = 'verified', verification = $2, verified_by = $3, verified_at = now(),
                   reward_badge = $4, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`,
                [quest.id, via, subject ? (staff ? `staff:${subject}` : subject) : null, badgeId],
            );
            const out = wireQuest(updated, { votes: (await countsForQuest(quest.id, t)).votes, checks });
            await search.sync(t, 'quest', out);
            return { ok: true, quest: out, reward: reward ? wireReward(reward) : null, quorum: checks };
        });
    }

    function wireReward(row) {
        if (!row) return null;
        return { id: row.id, quest_id: row.quest_id, subject: row.subject, coins: Number(row.coins) || 0, state: row.state, detail: row.detail || null, attempts: Number(row.attempts) || 0, created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
    }

    async function setRewardState(id, { state, detail = null }) {
        if (!['pending', 'credited', 'skipped', 'failed'].includes(state)) return null;
        const row = await db.maybe(
            `UPDATE fun_quest_rewards SET state = $2, detail = $3, attempts = attempts + 1, updated_at = now()
             WHERE id = $1 RETURNING *`, [String(id), state, detail == null ? null : String(detail).slice(0, 500)]);
        return wireReward(row);
    }

    async function hideQuest({ slug, staff = false }) {
        if (!staff) return refusal(403, 'fun.staff_required', 'Only staff can hide a quest.');
        return await s.tx(async (t) => {
            const quest = await byQuestSlug(slug, t);
            if (!quest) return refusal(404, 'fun.quest_not_found', 'No such quest.');
            if (quest.visibility === 'hidden') return { ok: true, quest: wireQuest(quest), unchanged: true };
            const updated = await t.maybe("UPDATE fun_quests SET visibility = 'hidden', status = 'hidden', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [quest.id]);
            await search.sync(t, 'quest', wireQuest(updated));
            return { ok: true, quest: wireQuest(updated) };
        });
    }

    async function questForPage(slug, { subject = null, staff = false } = {}) {
        const quest = await byQuestSlug(slug);
        if (!quest) return null;
        const board = await boardById(quest.board_id);
        const isOwner = Boolean(subject && board && board.streamer_subject === subject);
        if (quest.visibility === 'hidden' && !staff && !isOwner) return null;
        if (quest.visibility === 'unlisted' && !staff && !isOwner && !subject) {
            // An unlisted suggestion is visible by its board link, not by the public quest URL, unless signed in.
            // The board page is the shareable place; the quest page still works for a signed-in viewer by design.
        }
        const counts = await countsForQuest(quest.id);
        const voted = subject ? Boolean(await db.maybe('SELECT 1 AS x FROM fun_quest_votes WHERE quest_id = $1 AND voter = $2', [quest.id, subject])) : false;
        return { quest: wireQuest(quest, { votes: counts.votes, checks: counts.checks, mine: isOwner, voted }), board: wireBoard(board) };
    }

    async function listQuests({ limit = 20, cursor = null, city = null, status = null } = {}) {
        const n = Math.min(50, Math.max(1, Number(limit) || 20));
        const args = [];
        let where = `visibility = 'public' AND status = ANY($1::text[])`;
        args.push(PUBLIC_QUEST_STATUSES);
        if (status) {
            if (!PUBLIC_QUEST_STATUSES.includes(status)) return { quests: [], next_cursor: null, error: 'status' };
            args.push(status); where += ` AND status = $${args.length}`;
        }
        if (city) { args.push(String(city).slice(0, 120)); where += ` AND lower(city) = lower($${args.length})`; }
        let pos = null;
        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
                if (typeof decoded.t === 'string' && typeof decoded.i === 'string' && !Number.isNaN(Date.parse(decoded.t))) pos = decoded;
            } catch { /* refused below */ }
            if (!pos) return { quests: [], next_cursor: null, error: 'cursor' };
            args.push(pos.t, pos.i); where += ` AND (created_at, id) < ($${args.length - 1}::timestamptz, $${args.length})`;
        }
        args.push(n + 1);
        const rows = await db.many(`SELECT * FROM fun_quests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${args.length}`, args);
        const hasMore = rows.length > n;
        const page = rows.slice(0, n);
        const counts = await voteCounts(page.map((r) => r.id));
        const last = page[page.length - 1];
        return {
            quests: page.map((r) => wireQuest(r, { votes: counts[r.id] || 0 })),
            next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ t: iso(last.created_at), i: last.id })).toString('base64url') : null,
        };
    }

    async function featuredQuests(limit = 6) {
        const rows = await db.many(
            `SELECT * FROM fun_quests WHERE visibility = 'public' AND status = ANY($1::text[])
             ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'accepted' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, created_at DESC LIMIT $2`,
            [PUBLIC_QUEST_STATUSES, Math.min(20, Math.max(1, Number(limit) || 6))],
        );
        const counts = await voteCounts(rows.map((r) => r.id));
        return rows.map((r) => wireQuest(r, { votes: counts[r.id] || 0 }));
    }

    // ── Group plans ─────────────────────────────────────────
    function planFields({ title, summary, city, lat, lon, timezone, startsAt, closesAt, visibility = 'unlisted', chatUsername = null }) {
        const t = clean(title, 120);
        if (t.length < 3 || t.length > 120) return refusal(400, 'fun.plan.invalid', 'title must be 3 to 120 characters', 'title');
        const sum = summary == null || summary === '' ? null : clean(summary, 1200);
        if (sum !== null && !sum) return refusal(400, 'fun.plan.invalid', 'summary must be at most 1200 characters', 'summary');
        const c = city == null || city === '' ? null : clean(city, 120);
        if (c !== null && !c) return refusal(400, 'fun.plan.invalid', 'city must be 1 to 120 characters', 'city');
        const la = num(lat); const lo = num(lon);
        if (la != null && (la < -90 || la > 90)) return refusal(400, 'fun.plan.invalid', 'lat must be -90 to 90', 'lat');
        if (lo != null && (lo < -180 || lo > 180)) return refusal(400, 'fun.plan.invalid', 'lon must be -180 to 180', 'lon');
        const tz = String(timezone || 'UTC');
        if (!validTimezone(tz)) return refusal(400, 'fun.plan.invalid', 'timezone must be a valid IANA zone', 'timezone');
        const start = parseWhen(startsAt);
        if (!start) return refusal(400, 'fun.plan.invalid', 'starts_at must be an ISO time', 'starts_at');
        if (start.getTime() < s.now() + 5 * 60_000) return refusal(400, 'fun.plan.invalid', 'starts_at must be at least 5 minutes ahead', 'starts_at');
        if (start.getTime() > s.now() + 366 * 86_400_000) return refusal(400, 'fun.plan.invalid', 'starts_at must be within a year', 'starts_at');
        const close = closesAt ? parseWhen(closesAt) : new Date(start.getTime() - 60 * 60_000);
        if (!close) return refusal(400, 'fun.plan.invalid', 'closes_at must be an ISO time', 'closes_at');
        if (close.getTime() <= s.now() + 60_000) return refusal(400, 'fun.plan.invalid', 'closes_at must be in the future', 'closes_at');
        if (close.getTime() > start.getTime()) return refusal(400, 'fun.plan.invalid', 'closes_at must not be after starts_at', 'closes_at');
        if (!VISIBILITIES.includes(visibility)) return refusal(400, 'fun.plan.invalid', 'visibility must be public, unlisted or hidden', 'visibility');
        if (chatUsername != null && chatUsername !== '' && !USERNAME_RE.test(String(chatUsername))) return refusal(400, 'fun.plan.invalid', 'chat_username is not a Live/Chat username', 'chat_username');
        return { ok: true, fields: { title: t, summary: sum, city: c, lat: la, lon: lo, timezone: tz, starts_at: start.toISOString(), closes_at: close.toISOString(), visibility, chat_username: chatUsername ? String(chatUsername) : null } };
    }

    async function createPlan({ ownerSubject, ownerUsername = null, title, summary = null, city = null, lat = null, lon = null, timezone = 'UTC', startsAt, closesAt = null, visibility = 'unlisted', chatUsername = null, options = [] }) {
        if (!SUBJECT_RE.test(String(ownerSubject || ''))) return refusal(403, 'fun.person_required', 'A plan belongs to a signed-in person.');
        const checked = planFields({ title, summary, city, lat, lon, timezone, startsAt, closesAt, visibility, chatUsername });
        if (!checked.ok) return checked;
        const opts = Array.isArray(options) ? options.slice(0, 10) : [];
        const cleaned = [];
        for (const [i, o] of opts.entries()) {
            const titleOk = clean(o && o.title, 120);
            if (!titleOk) continue;
            cleaned.push({ ...o, title: titleOk, position: i + 1 });
        }
        return await s.tx(async (t) => {
            const slug = await uniqueSlug(checked.fields.title, t);
            const id = s.newId('pln');
            const row = await t.maybe(
                `INSERT INTO fun_plans (id, slug, owner_subject, owner_username, title, summary, city, lat, lon, timezone, starts_at, closes_at, status, visibility, chat_username, revision)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::timestamptz, 'voting', $13, $14, 1) RETURNING *`,
                [id, slug, ownerSubject, ownerUsername ? clean(ownerUsername, 64) : null, checked.fields.title, checked.fields.summary, checked.fields.city,
                    checked.fields.lat, checked.fields.lon, checked.fields.timezone, checked.fields.starts_at, checked.fields.closes_at,
                    checked.fields.visibility, checked.fields.chat_username],
            );
            const saved = [];
            for (const o of cleaned) {
                const opt = await t.maybe(
                    `INSERT INTO fun_plan_options (id, plan_id, title, details, place_name, lat, lon, accessible, price_note, starts_at, created_by, position)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12) RETURNING *`,
                    [s.newId('pop'), id, o.title, o.details ? clean(o.details, 1200) : null, o.place_name ? clean(o.place_name, 200) : null,
                        num(o.lat), num(o.lon), Boolean(o.accessible), o.price_note ? clean(o.price_note, 80) : null,
                        o.starts_at ? parseWhen(o.starts_at)?.toISOString() || null : null, ownerSubject, o.position],
                );
                saved.push(wireOption(opt));
            }
            const plan = wirePlan(row, { options: saved });
            if (row.visibility === 'public') await search.sync(t, 'plan', plan, saved);
            return { ok: true, plan };
        });
    }

    async function addPlanOption({ slug, subject, staff = false, title, details = null, placeName = null, lat = null, lon = null, accessible = false, priceNote = null, startsAt = null }) {
        const t = clean(title, 120);
        if (t.length < 1 || t.length > 120) return refusal(400, 'fun.plan.invalid', 'option title must be 1 to 120 characters', 'title');
        return await s.tx(async (tx) => {
            const plan = await planBySlug(slug, tx);
            if (!plan) return refusal(404, 'fun.plan_not_found', 'No such plan.');
            if (!staff && plan.owner_subject !== subject) return refusal(403, 'fun.plan_owner', 'Only the plan owner can add an option.');
            if (plan.status !== 'voting') return refusal(409, 'fun.plan_closed', 'This plan is not voting.');
            const n = Number(await tx.value('SELECT COUNT(*)::int FROM fun_plan_options WHERE plan_id = $1', [plan.id])) || 0;
            if (n >= 10) return refusal(409, 'fun.plan_full', 'A plan has at most 10 options.');
            const opt = await tx.maybe(
                `INSERT INTO fun_plan_options (id, plan_id, title, details, place_name, lat, lon, accessible, price_note, starts_at, created_by, position)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12) RETURNING *`,
                [s.newId('pop'), plan.id, t, details ? clean(details, 1200) : null, placeName ? clean(placeName, 200) : null,
                    num(lat), num(lon), Boolean(accessible), priceNote ? clean(priceNote, 80) : null,
                    startsAt ? parseWhen(startsAt)?.toISOString() || null : null, subject, n + 1],
            );
            const updated = await tx.maybe('UPDATE fun_plans SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *', [plan.id]);
            const options = (await tx.many('SELECT * FROM fun_plan_options WHERE plan_id = $1 ORDER BY position', [plan.id])).map((o) => wireOption(o));
            if (updated.visibility === 'public') await search.sync(tx, 'plan', wirePlan(updated, { options }), options);
            return { ok: true, option: wireOption(opt) };
        });
    }

    async function castPlanVote({ slug, subject = null, chatUsername = null, optionId = null, position = null, via = 'web', chatMessageId = null }) {
        if (!['web', 'chat'].includes(via)) return refusal(400, 'fun.plan.invalid', 'via must be web or chat', 'via');
        const voter = via === 'chat'
            ? (chatUsername && USERNAME_RE.test(String(chatUsername)) ? chatVoter(chatUsername) : null)
            : (subject && SUBJECT_RE.test(String(subject)) ? subject : null);
        if (!voter) return refusal(403, 'fun.person_required', 'A vote needs a signed-in person or a public chat username.');
        return await s.tx(async (t) => {
            const plan = await planBySlug(slug, t);
            if (!plan || plan.visibility === 'hidden') return refusal(404, 'fun.plan_not_found', 'No such plan.');
            if (plan.status !== 'voting') return refusal(409, 'fun.plan_closed', 'This plan is not voting.');
            if (new Date(plan.closes_at).getTime() <= s.now()) return refusal(409, 'fun.plan_closed', 'Voting has closed.');
            let opt = null;
            if (optionId) opt = await t.maybe('SELECT * FROM fun_plan_options WHERE id = $1 AND plan_id = $2', [String(optionId), plan.id]);
            else if (position != null) opt = await t.maybe('SELECT * FROM fun_plan_options WHERE plan_id = $1 AND position = $2', [plan.id, Number(position)]);
            if (!opt) return refusal(404, 'fun.plan_option_not_found', 'No such option on this plan.');
            await t.exec(
                `INSERT INTO fun_plan_votes (plan_id, voter, subject, option_id, via, chat_message_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now(), now())
                 ON CONFLICT (plan_id, voter) DO UPDATE SET option_id = EXCLUDED.option_id, via = EXCLUDED.via, subject = EXCLUDED.subject,
                   chat_message_id = COALESCE(EXCLUDED.chat_message_id, fun_plan_votes.chat_message_id), updated_at = now()`,
                [plan.id, voter, via === 'web' ? subject : null, opt.id, via, chatMessageId ? String(chatMessageId).slice(0, 80) : null],
            );
            return { ok: true, plan_id: plan.id, option_id: opt.id, position: Number(opt.position), voter };
        });
    }

    async function decidePlan({ slug, subject, staff = false }) {
        return await s.tx(async (t) => {
            const plan = await planBySlug(slug, t);
            if (!plan) return refusal(404, 'fun.plan_not_found', 'No such plan.');
            if (!staff && plan.owner_subject !== subject) return refusal(403, 'fun.plan_owner', 'Only the plan owner can decide it.');
            if (plan.status !== 'voting') return refusal(409, 'fun.plan_closed', 'This plan is not voting.');
            const rows = await t.many('SELECT option_id, COUNT(*)::int AS votes FROM fun_plan_votes WHERE plan_id = $1 GROUP BY option_id ORDER BY votes DESC, option_id ASC', [plan.id]);
            if (!rows.length) return refusal(409, 'fun.plan_no_votes', 'Nobody has voted yet.');
            const votes = rows.map((r) => ({ option_id: r.option_id, votes: Number(r.votes) || 0 }));
            if (votes.length > 1 && votes[0].votes === votes[1].votes) return refusal(409, 'fun.plan_tie', 'The vote is tied; add a tie-break or ask one more person to vote.');
            const updated = await t.maybe("UPDATE fun_plans SET status = 'decided', winner_option_id = $2, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [plan.id, votes[0].option_id]);
            const options = (await t.many('SELECT * FROM fun_plan_options WHERE plan_id = $1 ORDER BY position', [plan.id])).map((o) => wireOption(o));
            const out = wirePlan(updated, { options, votes });
            if (updated.visibility === 'public') await search.sync(t, 'plan', out, options);
            return { ok: true, plan: out, winner: options.find((o) => o.id === votes[0].option_id) || null };
        });
    }

    async function planForPage(slug, { subject = null, staff = false } = {}) {
        const plan = await planBySlug(slug);
        if (!plan) return null;
        const isOwner = Boolean(subject && plan.owner_subject === subject);
        if (plan.visibility === 'hidden' && !staff && !isOwner) return null;
        const rows = await db.many('SELECT * FROM fun_plan_options WHERE plan_id = $1 ORDER BY position', [plan.id]);
        const voteRows = await db.many('SELECT option_id, COUNT(*)::int AS votes FROM fun_plan_votes WHERE plan_id = $1 GROUP BY option_id', [plan.id]);
        const byOption = Object.fromEntries(voteRows.map((r) => [r.option_id, Number(r.votes) || 0]));
        const mine = subject ? await db.maybe('SELECT option_id FROM fun_plan_votes WHERE plan_id = $1 AND voter = $2', [plan.id, subject]) : null;
        const options = rows.map((r) => wireOption(r, { votes: byOption[r.id] || 0 }));
        const total = voteRows.reduce((n, r) => n + (Number(r.votes) || 0), 0);
        return {
            plan: wirePlan(plan, { options, total_votes: total, mine: isOwner, my_option_id: mine ? mine.option_id : null }),
            options,
            winner: plan.winner_option_id ? options.find((o) => o.id === plan.winner_option_id) || null : null,
            isOwner,
        };
    }

    async function listPlans({ limit = 20, cursor = null, city = null } = {}) {
        const n = Math.min(50, Math.max(1, Number(limit) || 20));
        const args = [];
        let where = "visibility = 'public' AND status IN ('voting', 'decided')";
        if (city) { args.push(String(city).slice(0, 120)); where += ` AND lower(city) = lower($${args.length})`; }
        let pos = null;
        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
                if (typeof decoded.t === 'string' && typeof decoded.i === 'string' && !Number.isNaN(Date.parse(decoded.t))) pos = decoded;
            } catch { /* refused */ }
            if (!pos) return { plans: [], next_cursor: null, error: 'cursor' };
            args.push(pos.t, pos.i); where += ` AND (created_at, id) < ($${args.length - 1}::timestamptz, $${args.length})`;
        }
        args.push(n + 1);
        const rows = await db.many(`SELECT * FROM fun_plans WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${args.length}`, args);
        const hasMore = rows.length > n;
        const page = rows.slice(0, n);
        const last = page[page.length - 1];
        return {
            plans: page.map(wirePlan),
            next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ t: iso(last.created_at), i: last.id })).toString('base64url') : null,
        };
    }

    async function planForToday(slug) {
        const plan = await planBySlug(slug);
        if (!plan) return null;
        if (plan.status !== 'decided' || !plan.winner_option_id) return { plan: wirePlan(plan), error: 'not_decided' };
        const options = (await db.many('SELECT * FROM fun_plan_options WHERE plan_id = $1 ORDER BY position', [plan.id])).map((o) => wireOption(o));
        return { plan: wirePlan(plan, { options }), winner: options.find((o) => o.id === plan.winner_option_id) || null };
    }

    async function hidePlan({ slug, staff = false }) {
        if (!staff) return refusal(403, 'fun.staff_required', 'Only staff can hide a plan.');
        return await s.tx(async (t) => {
            const plan = await planBySlug(slug, t);
            if (!plan) return refusal(404, 'fun.plan_not_found', 'No such plan.');
            if (plan.visibility === 'hidden') return { ok: true, plan: wirePlan(plan), unchanged: true };
            const updated = await t.maybe("UPDATE fun_plans SET visibility = 'hidden', status = 'cancelled', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [plan.id]);
            await search.sync(t, 'plan', wirePlan(updated), []);
            return { ok: true, plan: wirePlan(updated) };
        });
    }

    // ── Reports ──────────────────────────────────────────────
    async function createReport({ targetKind, targetId, subject, kind, reason, note = null }) {
        if (!SUBJECT_RE.test(String(subject || ''))) return refusal(403, 'fun.person_required', 'A report belongs to a signed-in person.');
        if (!['quest', 'plan'].includes(targetKind)) return refusal(400, 'fun.report.invalid', 'target_kind must be quest or plan', 'target_kind');
        if (!REPORT_KINDS.includes(kind)) return refusal(400, 'fun.report.invalid', 'kind must be safety, spam or other', 'kind');
        const r = clean(reason, 2000);
        if (r.length < 3) return refusal(400, 'fun.report.invalid', 'reason must be 3 to 2000 characters', 'reason');
        const n = note == null || note === '' ? null : clean(note, 4000);
        const target = targetKind === 'quest' ? await byQuestId(targetId) : await planById(targetId);
        if (!target) return refusal(404, 'fun.not_found', 'No such quest or plan.');
        const row = await db.maybe(
            `INSERT INTO fun_reports (id, target_kind, target_id, subject, kind, reason, note, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now()) RETURNING *`,
            [s.newId('frp'), targetKind, targetId, subject, kind, r, n],
        );
        return { ok: true, report: wireReport(row) };
    }

    async function listOpenReports({ limit = 100 } = {}) {
        const rows = await db.many(
            `SELECT r.*, COALESCE(q.title, p.title) AS target_title, COALESCE(q.slug, p.slug) AS target_slug
             FROM fun_reports r
             LEFT JOIN fun_quests q ON r.target_kind = 'quest' AND q.id = r.target_id
             LEFT JOIN fun_plans p ON r.target_kind = 'plan' AND p.id = r.target_id
             WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT $1`,
            [Math.min(200, Math.max(1, Number(limit) || 100))],
        );
        return rows.map(wireReport);
    }

    async function counts() {
        const row = await db.maybe(
            `SELECT (SELECT COUNT(*)::int FROM fun_quests WHERE visibility = 'public' AND status = ANY($1::text[])) AS quests,
                    (SELECT COUNT(*)::int FROM fun_plans WHERE visibility = 'public' AND status IN ('voting','decided')) AS plans,
                    (SELECT COUNT(*)::int FROM fun_badges) AS badges`, [PUBLIC_QUEST_STATUSES]);
        return { quests: Number(row && row.quests) || 0, plans: Number(row && row.plans) || 0, badges: Number(row && row.badges) || 0 };
    }

    async function publicQuestsForSitemap(limit = 5000) {
        return await db.many("SELECT slug, updated_at FROM fun_quests WHERE visibility = 'public' AND status = ANY($1::text[]) ORDER BY updated_at DESC LIMIT $2", [PUBLIC_QUEST_STATUSES, limit]);
    }
    async function publicPlansForSitemap(limit = 5000) {
        return await db.many("SELECT slug, updated_at FROM fun_plans WHERE visibility = 'public' AND status IN ('voting','decided') ORDER BY updated_at DESC LIMIT $1", [limit]);
    }
    async function publicQuestsForLlms(limit = 2000) {
        return await db.many("SELECT slug, title, brief, category, status, city FROM fun_quests WHERE visibility = 'public' AND status = ANY($1::text[]) ORDER BY created_at DESC LIMIT $2", [PUBLIC_QUEST_STATUSES, limit]);
    }
    async function publicPlansForLlms(limit = 2000) {
        return await db.many("SELECT slug, title, summary, status, city, starts_at FROM fun_plans WHERE visibility = 'public' AND status IN ('voting','decided') ORDER BY starts_at ASC LIMIT $1", [limit]);
    }

    return {
        wireBoard, wireQuest, wirePlan, wireOption, wireReport, wireReward,
        byQuestSlug, byQuestId, boardById, planBySlug, planById, uniqueSlug,
        createBoard, boardForSubject, boardPage, openBoardsForChat, createSuggestion, questsForSubject,
        castQuestVote, recordQuestCheck, acceptQuest, setQuestStatus, verifyQuest, hideQuest, questForPage,
        listQuests, featuredQuests,
        createPlan, addPlanOption, castPlanVote, decidePlan, planForPage, listPlans, planForToday, hidePlan,
        createReport, listOpenReports, counts, setRewardState,
        publicQuestsForSitemap, publicPlansForSitemap, publicQuestsForLlms, publicPlansForLlms,
        QUEST_STATUSES, PUBLIC_QUEST_STATUSES, VISIBILITIES, PLAN_STATUSES, REPORT_KINDS,
    };
}

function slugify(title) {
    const s = String(title || '')
        .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 65);
    return s || 'fun';
}

module.exports = { createStore, slugify, wireBoard, wireQuest, wirePlan, wireOption, wireReport, SLUG_RE, USERNAME_RE, SUBJECT_RE, QUEST_STATUSES, PUBLIC_QUEST_STATUSES, VISIBILITIES, PLAN_STATUSES, REPORT_KINDS };
