'use strict';

/**
 * The public reads and the one person-authorized write Fun makes outside itself. No service grant is used here:
 *
 *   OpenVibe.Live  GET /api/streams/channel/:username/live   public channel + whether it is live now
 *   OpenVibe.Chat  GET /api/chat/global/history?username=…   public history; Fun reads `!quest`/`!plan` commands,
 *                                                             it never posts a message
 *   OpenVibe.Today POST /api/v1/events                       called with the viewer's own Network token as a Bearer
 *                                                             when they press "Add to Today"; no service token
 *
 * A 404 from Live means no such channel. A failure is a typed upstream error, never cached, and no token or body is
 * logged.
 */
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

class UpstreamError extends Error {
    constructor(code, detail, { status = 502 } = {}) { super(detail); this.code = code; this.status = status; }
}

function createUpstreams({ config, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    const { live, chat, today, timeoutMs } = config.upstreams;
    const base = (u) => String(u).replace(/\/+$/, '');
    const channels = new Map();


    async function call(url, { method = 'GET', headers = {}, body = null, timeout = timeoutMs } = {}) {
        let res;
        try {
            res = await fetchImpl(url, {
                method,
                headers: { Accept: 'application/json', 'User-Agent': `OpenVibe.Fun/0.1 (+${config.baseUrl})`, ...headers },
                body,
                signal: AbortSignal.timeout(timeout),
            });
        } catch (err) {
            throw new UpstreamError('fun.upstream.unreachable', 'the upstream service did not answer', { status: 502 });
        }
        return res;
    }

    /**
     * The public Live channel. A channel that does not exist answers { found:false }; a live one carries the first
     * stream's title and viewer count. The answer is kept in memory for 30 s; a failure is not kept.
     */
    async function liveChannel(username) {
        const name = String(username || '').trim();
        if (!USERNAME_RE.test(name)) throw new UpstreamError('fun.live.invalid', 'a Live username is required', { status: 422 });
        const key = name.toLowerCase();
        const hit = channels.get(key);
        if (hit && now() - hit.at < 30_000) return { ...hit.value, cached: true };
        const res = await call(`${base(live)}/api/streams/channel/${encodeURIComponent(name)}/live`);
        if (res.status === 404) return { found: false, username: name };
        if (!res.ok) throw new UpstreamError('fun.live.unavailable', `OpenVibe.Live answered ${res.status}`);
        const data = await res.json().catch(() => null);
        if (!data || !data.channel) throw new UpstreamError('fun.live.unavailable', 'OpenVibe.Live answered no channel');
        const streams = Array.isArray(data.streams) ? data.streams : [];
        const first = streams[0] || null;
        const value = {
            found: true,
            username: String(data.channel.username || name),
            display_name: typeof data.channel.display_name === 'string' ? data.channel.display_name.slice(0, 80) : null,
            live: streams.length > 0,
            title: first && typeof first.title === 'string' ? first.title.slice(0, 200) : null,
            viewers: first && Number.isFinite(Number(first.viewer_count)) ? Number(first.viewer_count) : null,
            url: `https://openvibe.live/@${encodeURIComponent(String(data.channel.username || name))}`,
        };
        channels.set(key, { at: now(), value });
        if (channels.size > 500) for (const [k, v] of channels) if (now() - v.at > 10 * 60_000) channels.delete(k);
        return value;
    }

    /** One public page of a channel's chat history (oldest→newest when after_id is used). Never a write. */
    async function chatHistory({ username, afterId = null, limit = 200 } = {}) {
        const name = String(username || '').trim();
        if (!USERNAME_RE.test(name)) throw new UpstreamError('fun.chat.invalid', 'a Chat username is required', { status: 422 });
        const q = new URLSearchParams({ username: name, limit: String(Math.min(500, Math.max(1, Number(limit) || 200))) });
        if (afterId != null && afterId !== '') q.set('after_id', String(afterId));
        const res = await call(`${base(chat)}/api/chat/global/history?${q.toString()}`);
        if (res.status === 404) return { messages: [] };
        if (!res.ok) throw new UpstreamError('fun.chat.unavailable', `OpenVibe.Chat answered ${res.status}`);
        const data = await res.json().catch(() => null);
        if (!data) throw new UpstreamError('fun.chat.unavailable', 'OpenVibe.Chat answered no JSON');
        return { messages: Array.isArray(data.messages) ? data.messages : [] };
    }

    /**
     * Create one event in the caller's own Today. `token` is the viewer's Network session token from their cookie or
     * Bearer; it is sent only here and never stored. The idempotency key is a stable plan id.
     */
    async function todayCreate({ token, body, idempotencyKey = null } = {}) {
        if (!token) throw new UpstreamError('fun.today.sign_in', 'a person\'s Network token is needed to add a plan to Today', { status: 401 });
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 100);
        let res;
        try {
            res = await call(`${base(today)}/api/v1/events`, { method: 'POST', headers, body: JSON.stringify(body), timeout: 8000 });
        } catch (err) {
            throw new UpstreamError('fun.today.unavailable', 'OpenVibe.Today did not answer');
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const detail = data && (data.message || data.code) ? String(data.message || data.code).slice(0, 200) : `OpenVibe.Today answered ${res.status}`;
            throw new UpstreamError('fun.today.refused', detail, { status: res.status >= 400 && res.status < 500 ? res.status : 502 });
        }
        if (!data || !data.id) throw new UpstreamError('fun.today.unavailable', 'OpenVibe.Today answered no event');
        return { id: data.id, url: `https://openvibe.today/e/${encodeURIComponent(data.id)}`, event: data };
    }

    return { liveChannel, chatHistory, todayCreate, UpstreamError, base };
}

module.exports = { createUpstreams, UpstreamError, USERNAME_RE };
