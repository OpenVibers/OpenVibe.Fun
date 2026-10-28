'use strict';

/**
 * Chat votes, read — never posted. The public OpenVibe.Chat history for the streamer's channel is read on a timer;
 * a message is considered at most once (fun_chat_seen), and the commands it understands are:
 *
 *   !quest vote <slug>            one vote for that suggestion
 *   !quest suggest <text>         a suggestion on the open board for this channel (safety-filtered)
 *   !quest verify <slug>          a check towards the chat quorum on a completed quest
 *   !plan vote <slug> <number>    one vote for option <number> on a group plan
 *
 * No message, account or token is written: a chat vote stores the public chat username, the message id and the
 * choice. The job does nothing under FUN_DRILL; tests call runOnce().
 */
const { USERNAME_RE } = require('./store');

const COMMAND_RE = /^!(quest|plan)\s+(vote|suggest|verify)\b\s*(.*)$/i;

/** Chat ids are integers today; compare numerically when both are, else as strings. */
function newer(a, b) {
    if (b == null || b === '') return true;
    if (/^\d+$/.test(String(a)) && /^\d+$/.test(String(b))) return BigInt(a) > BigInt(b);
    return String(a) > String(b);
}

function parseCommand(message, username) {
    const text = String(message || '').replace(/\s+/g, ' ').trim();
    const m = COMMAND_RE.exec(text);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    const verb = m[2].toLowerCase();
    const rest = m[3].trim();
    if (!USERNAME_RE.test(String(username || ''))) return null;
    if (kind === 'quest' && verb === 'vote') {
        const slug = rest.split(/\s+/)[0];
        return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? { kind, verb, slug } : null;
    }
    if (kind === 'quest' && verb === 'suggest') return rest.length >= 3 ? { kind, verb, text: rest.slice(0, 600) } : null;
    if (kind === 'quest' && verb === 'verify') {
        const slug = rest.split(/\s+/)[0];
        return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? { kind, verb, slug } : null;
    }
    if (kind === 'plan' && verb === 'vote') {
        const parts = rest.split(/\s+/);
        const slug = parts[0];
        const position = Number.parseInt(parts[1], 10);
        return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && Number.isInteger(position) && position >= 1 && position <= 10
            ? { kind, verb, slug, position } : null;
    }
    return null;
}

function createChatSync({ config, s, store, upstreams, log = console, now = () => Date.now() }) {
    let timer = null;
    let running = false;

    async function boardsToRead() {
        const rows = await s.db.many(
            `SELECT DISTINCT chat_username FROM fun_quest_boards WHERE closes_at > now() - interval '1 day'
             UNION SELECT DISTINCT chat_username FROM fun_plans WHERE status = 'voting' AND visibility <> 'hidden' AND chat_username IS NOT NULL
             ORDER BY chat_username LIMIT 20`,
        );
        return rows.map((r) => r.chat_username).filter((u) => USERNAME_RE.test(String(u)));
    }

    async function cursorFor(username) {
        const row = await s.db.maybe('SELECT last_message_id FROM fun_chat_cursors WHERE chat_username = $1', [username]);
        return row ? row.last_message_id : null;
    }

    async function setCursor(username, messageId) {
        await s.db.exec(
            `INSERT INTO fun_chat_cursors (chat_username, last_message_id, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (chat_username) DO UPDATE SET last_message_id = EXCLUDED.last_message_id, updated_at = now()`,
            [username, messageId == null ? null : String(messageId).slice(0, 80)],
        );
    }

    /** Read one channel's public history and apply at most one command per new message. */
    async function readChannel(username) {
        const afterId = await cursorFor(username);
        const page = await upstreams.chatHistory({ username, afterId, limit: config.quests.syncLimit });
        const messages = Array.isArray(page.messages) ? page.messages : [];
        const out = { messages: messages.length, votes: 0, suggestions: 0, checks: 0, planVotes: 0 };
        let lastId = afterId;
        for (const msg of messages) {
            if (!msg || msg.id == null) continue;
            const messageId = String(msg.id);
            // Advance the cursor even for a deleted or ignored message, or it would be read forever.
            if (newer(messageId, lastId)) lastId = messageId;
            if (Number(msg.is_deleted) === 1) continue;
            const seen = await s.db.maybe(
                'INSERT INTO fun_chat_seen (chat_username, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id',
                [username, messageId],
            );
            if (!seen) continue;
            const command = parseCommand(msg.message, msg.username);
            if (!command) continue;
            const chatUsername = String(msg.username).slice(0, 64);
            if (command.kind === 'quest' && command.verb === 'vote') {
                const out2 = await store.castQuestVote({ slug: command.slug, chatUsername, via: 'chat', chatMessageId: messageId });
                if (out2.ok) out.votes++;
            } else if (command.kind === 'quest' && command.verb === 'suggest') {
                const boards = await store.openBoardsForChat(username);
                if (boards.length) {
                    const out2 = await store.createSuggestion({ boardId: boards[0].id, chatUsername, title: command.text, brief: command.text, category: 'near_me', source: 'chat', accessible: false });
                    if (out2.ok) out.suggestions++;
                }
            } else if (command.kind === 'quest' && command.verb === 'verify') {
                const out2 = await store.recordQuestCheck({ slug: command.slug, chatUsername, via: 'chat', chatMessageId: messageId });
                if (out2.ok) out.checks++;
            } else if (command.kind === 'plan' && command.verb === 'vote') {
                const out2 = await store.castPlanVote({ slug: command.slug, chatUsername, position: command.position, via: 'chat', chatMessageId: messageId });
                if (out2.ok) out.planVotes++;
            }
        }
        if (lastId != null && lastId !== afterId) await setCursor(username, lastId);
        return out;
    }

    async function runOnce() {
        if (running) return { skipped: 'already_running' };
        running = true;
        const total = { channels: 0, messages: 0, votes: 0, suggestions: 0, checks: 0, planVotes: 0, errors: 0 };
        try {
            for (const username of await boardsToRead()) {
                total.channels++;
                try {
                    const out = await readChannel(username);
                    total.messages += out.messages; total.votes += out.votes; total.suggestions += out.suggestions; total.checks += out.checks; total.planVotes += out.planVotes;
                } catch (err) {
                    total.errors++;
                    log.warn(`[OpenVibe.Fun] chat read for @${username} failed: ${(err && err.message) || err}`);
                }
            }
        } finally { running = false; }
        return total;
    }

    function start() {
        if (config.drill || timer) return null;
        timer = setInterval(() => { runOnce().catch((err) => log.warn('[OpenVibe.Fun] chat sync failed:', (err && err.message) || err)); }, config.quests.syncIntervalMs);
        if (timer.unref) timer.unref();
        return timer;
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    return { runOnce, readChannel, parseCommand, start, stop, status: () => ({ running, timer: Boolean(timer) }) };
}

module.exports = { createChatSync, parseCommand, COMMAND_RE };
