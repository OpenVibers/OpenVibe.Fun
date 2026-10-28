'use strict';

/**
 * OpenCoins for a verified IRL quest. OpenCoins are loyalty points, never money: Fun holds no balance and never
 * reads one. The wallet belongs to OpenVibe.Network (POST /internal/coins/credit, network.coins-change-request@1),
 * keyed by the Network user id, so a subject is resolved first (GET /internal/identity/resolve).
 *
 * Auth is this service's own client credentials for `fun`, audience openvibe.network, scopes
 * `identity.subject.resolve network.coins.credit`. Off by default (`FUN_COINS=off`): the badge is still paid, the
 * reward is recorded `skipped`, and nothing is sent. The daily caps are the same shape as Quest's. A failure is
 * recorded and retried with the reward id as the idempotency key, so a retry cannot double-credit.
 */
const { serviceAuth } = require('openvibe-contracts');

const APP_ID = 'fun';
const AUDIENCE = 'openvibe.network';
const SCOPES = 'identity.subject.resolve network.coins.credit';
const TIMEOUT_MS = 5000;

function createCoins({ config, s, store, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const enabled = config.coins.mode === 'on';
    const base = String(config.networkInternalUrl || '').replace(/\/+$/, '');
    let tokens = null;
    if (enabled && config.oauth.clientSecret) {
        tokens = serviceAuth.createTokenClient({
            tokenUrl: `${base}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
            audience: AUDIENCE, scope: SCOPES, fetchImpl,
        });
    }
    let timer = null;
    const stats = { credited: 0, skipped: 0, failed: 0, attempts: 0, last_at: null };

    async function call(method, path, { query, body } = {}) {
        if (!tokens) throw new Error('OpenCoins is on but the OAuth client secret is unset');
        const url = new URL(base + path);
        for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error(`Network ${res.status}${json && (json.error || json.code) ? `: ${json.error || json.code}` : ''}`);
            err.status = res.status;
            throw err;
        }
        return json || {};
    }

    async function networkUserId(subject) {
        try {
            const out = await call('GET', '/internal/identity/resolve', { query: { subject_id: subject } });
            const id = out && out.network_user_id;
            return Number.isInteger(id) && id > 0 ? id : null;
        } catch (err) {
            if (err.status === 404) return null;
            throw err;
        }
    }

    async function creditedToday(subject) {
        const row = await s.db.maybe("SELECT COALESCE(SUM(coins), 0)::int AS n FROM fun_quest_rewards WHERE subject = $1 AND state = 'credited' AND updated_at::date = (now() AT TIME ZONE 'UTC')::date", [subject]);
        return Number(row && row.n) || 0;
    }
    async function creditedAllToday() {
        const row = await s.db.maybe("SELECT COALESCE(SUM(coins), 0)::int AS n FROM fun_quest_rewards WHERE state = 'credited' AND updated_at::date = (now() AT TIME ZONE 'UTC')::date");
        return Number(row && row.n) || 0;
    }

    async function credit({ reward, quest }) {
        const userId = await networkUserId(reward.subject);
        if (!userId) throw new Error('the Network has no account for this subject yet');
        const out = await call('POST', '/internal/coins/credit', {
            body: {
                user_id: userId,
                app_id: APP_ID,
                amount: reward.coins,
                reason: `fun:${quest.slug}`,
                ref: `${String(config.baseUrl).replace(/\/+$/, '')}/q/${quest.slug}`,
                idempotency_key: reward.id,
            },
        });
        return Number.isInteger(out.balance) ? out.balance : null;
    }

    /** Decide what happens to one reward now. Never throws; records a safe reason. */
    async function settle(reward, quest) {
        if (!reward) return null;
        if (!reward.coins) return store.setRewardState(reward.id, { state: 'skipped', detail: 'No OpenCoins are set for this quest.' });
        if (!enabled) {
            stats.skipped++;
            return store.setRewardState(reward.id, { state: 'skipped', detail: 'OpenCoins are off (FUN_COINS); the badge is paid.' });
        }
        try {
            const mine = await creditedToday(reward.subject);
            if (mine + reward.coins > config.coins.dailyCap) {
                stats.skipped++;
                return store.setRewardState(reward.id, { state: 'skipped', detail: `the daily cap of ${config.coins.dailyCap} OpenCoins per person is reached` });
            }
            const everyone = await creditedAllToday();
            if (everyone + reward.coins > config.coins.globalDailyCap) {
                stats.skipped++;
                return store.setRewardState(reward.id, { state: 'skipped', detail: `the network-wide daily cap of ${config.coins.globalDailyCap} OpenCoins is reached` });
            }
            stats.attempts++;
            const balance = await credit({ reward, quest });
            stats.credited++; stats.last_at = new Date(now()).toISOString();
            return store.setRewardState(reward.id, { state: 'credited', detail: balance == null ? null : `balance ${balance}` });
        } catch (err) {
            stats.failed++;
            const message = String((err && err.message) || err).slice(0, 200);
            log.warn(`[OpenCoins] reward ${reward.id} not credited: ${message}`);
            return store.setRewardState(reward.id, { state: 'failed', detail: message });
        }
    }

    async function retryPending({ limit = 50 } = {}) {
        if (!enabled) return { tried: 0, credited: 0, skipped: 0, failed: 0 };
        const rows = await s.db.many(
            `SELECT r.* FROM fun_quest_rewards r JOIN fun_quests q ON q.id = r.quest_id
             WHERE r.state IN ('pending', 'failed') ORDER BY r.updated_at ASC LIMIT $1`, [limit]);
        const out = { tried: rows.length, credited: 0, skipped: 0, failed: 0 };
        for (const row of rows) {
            const q = await s.db.maybe('SELECT slug FROM fun_quests WHERE id = $1', [row.quest_id]);
            if (!q) continue;
            const after = await settle(store.wireReward(row), q);
            if (after && after.state === 'credited') out.credited++;
            else if (after && after.state === 'skipped') out.skipped++;
            else if (after) out.failed++;
        }
        if (rows.length) log.log(`[OpenCoins] retried ${rows.length}: ${out.credited} credited, ${out.skipped} skipped, ${out.failed} still failing`);
        return out;
    }

    function start() {
        if (!enabled || timer) return null;
        timer = setInterval(() => { retryPending().catch((err) => log.warn('[OpenCoins] retry failed:', (err && err.message) || err)); }, config.coins.retryMs);
        if (timer.unref) timer.unref();
        return timer;
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }

    return { enabled, settle, retryPending, start, stop, networkUserId, credit, status: () => ({ enabled, daily_cap: config.coins.dailyCap, global_daily_cap: config.coins.globalDailyCap, ...stats }) };
}

module.exports = { createCoins, APP_ID, AUDIENCE, SCOPES };
