'use strict';

/**
 * The only outbound hosts the local guide reads: Nominatim (a place name → coordinates), Overpass (OpenStreetMap
 * places within a small radius) and, only when TICKETMASTER_API_KEY is configured, Ticketmaster's Discovery API.
 * Each is a community or free service with published usage rules, and this module is what keeps us inside them:
 *
 *   identify  every request carries FUN_OSM_USER_AGENT (an OpenVibe.Fun contact URL), never a browser's
 *   pace      one request a second per host by default; calls to a host queue behind each other
 *   cache     every answer is kept in fun_geo_cache for 7 days (OSM) or 15 minutes (Ticketmaster); a place is
 *             geocoded once, an area queried once, not once per visitor
 *   stale     if a host is down, the last answer is served from the cache rather than losing the page
 *   bound     Overpass is one `around:` radius and one set of tags, never a bulk download
 *
 * Only a URL built from configured bases is fetched; nothing a caller sends becomes a URL. No Ticketmaster key is
 * ever put in a cache key, a log line or an error message.
 */
const crypto = require('crypto');

class GuideError extends Error {
    constructor(code, detail, { status = 502 } = {}) { super(detail); this.code = code; this.status = status; }
}

/** Serialises calls to one host and keeps at least `minIntervalMs` between the moments they start. */
function createPacer({ minIntervalMs, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    let chain = Promise.resolve();
    let last = -Infinity;
    return {
        run(fn) {
            const p = chain.then(async () => {
                const wait = last + minIntervalMs - now();
                if (wait > 0) await sleep(wait);
                last = now();
                return fn();
            });
            chain = p.then(() => undefined, () => undefined);
            return p;
        },
    };
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const keyOf = (q) => String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');

function createUpstreams({ config, s, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    const osm = config.osm;
    const tm = config.ticketmaster;
    const db = s.db;
    const failed = new Map();
    const pacers = new Map();
    const pacerFor = (rawUrl, minIntervalMs) => {
        const host = new URL(rawUrl).host;
        if (!pacers.has(host)) pacers.set(host, createPacer({ minIntervalMs, now }));
        return pacers.get(host);
    };

    async function cacheGet(key, { stale = false } = {}) {
        const row = await db.maybe('SELECT body, fetched_at, expires_at FROM fun_geo_cache WHERE key = $1', [key]);
        if (!row) return null;
        const expired = new Date(row.expires_at).getTime() <= now();
        if (expired && !stale) return null;
        return { body: row.body, fetched_at: new Date(row.fetched_at).toISOString(), expires_at: new Date(row.expires_at).toISOString(), stale: expired };
    }

    async function cachePut(key, body, ttlMs) {
        const fetchedAt = new Date(now()).toISOString();
        const expiresAt = new Date(now() + ttlMs).toISOString();
        await db.exec(
            `INSERT INTO fun_geo_cache (key, body, fetched_at, expires_at) VALUES ($1, $2::jsonb, $3::timestamptz, $4::timestamptz)
             ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
            [key, JSON.stringify(body), fetchedAt, expiresAt],
        );
        return { fetched_at: fetchedAt, expires_at: expiresAt };
    }

    async function fetchJson(url, init = {}, { timeoutMs = osm.timeoutMs, minIntervalMs = osm.minIntervalMs, what = 'OpenStreetMap' } = {}) {
        let res;
        try {
            res = await pacerFor(url.toString(), minIntervalMs).run(() => fetchImpl(url.toString(), {
                ...init,
                headers: {
                    'User-Agent': osm.userAgent,
                    Accept: 'application/json',
                    ...(init.headers || {}),
                },
                signal: AbortSignal.timeout(timeoutMs),
            }));
        } catch (err) {
            throw new GuideError('fun.guide.upstream', `${what} could not be reached (${err && err.name === 'TimeoutError' ? 'timed out' : 'network error'})`);
        }
        if (!res.ok) throw new GuideError('fun.guide.upstream', `${what} answered ${res.status}`);
        try {
            return await res.json();
        } catch {
            throw new GuideError('fun.guide.upstream', `${what} answered something that is not JSON`);
        }
    }

    async function cached(key, fn, { ttlMs, failedWithinMs = 0, force = false, what = 'OpenStreetMap' } = {}) {
        const hit = force ? null : await cacheGet(key);
        if (hit) return { ...hit, cached: true };
        if (failedWithinMs && !force && now() - (failed.get(key) || -Infinity) < failedWithinMs) {
            const old = await cacheGet(key, { stale: true });
            if (old) return { ...old, cached: true, stale: true };
            throw new GuideError('fun.guide.upstream', `${what} was busy a moment ago. Try again in a few minutes.`);
        }
        let body;
        try {
            body = await fn();
            failed.delete(key);
        } catch (err) {
            if (failedWithinMs) {
                if (failed.size > 1000) failed.clear();
                failed.set(key, now());
            }
            const old = await cacheGet(key, { stale: true });
            if (old) return { ...old, cached: true, stale: true };
            throw err;
        }
        const written = await cachePut(key, body, ttlMs);
        return { body, cached: false, stale: false, fetched_at: written.fetched_at, expires_at: written.expires_at };
    }

    /** A place name → at most five matches (Nominatim search), cached for the OSM TTL. */
    function geocode(q, { limit = 1 } = {}) {
        const query = String(q || '').trim().slice(0, 200);
        if (!query) return Promise.reject(new GuideError('fun.guide.invalid', 'q: a place to search for', { status: 422 }));
        const url = new URL(osm.nominatimUrl);
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`;
        const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(Math.min(Math.max(limit, 1), 5)), addressdetails: '1' });
        if (osm.email) params.set('email', osm.email);
        url.search = params.toString();
        const key = `nominatim:v1:${sha(`${keyOf(query)}:${limit}`)}`;
        return cached(key, () => fetchJson(url, {}, { what: 'OpenStreetMap Nominatim' }), { ttlMs: osm.cacheTtlMs, failedWithinMs: osm.retryAfterMs, what: 'OpenStreetMap Nominatim' });
    }

    /** One bounded Overpass query → its elements, cached by the exact query. */
    function overpass(query) {
        const body = `data=${encodeURIComponent(String(query))}`;
        const key = `overpass:v1:${sha(query)}`;
        return cached(key, () => fetchJson(new URL(osm.overpassUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        }, { what: 'OpenStreetMap Overpass' }), { ttlMs: osm.cacheTtlMs, failedWithinMs: osm.retryAfterMs, what: 'OpenStreetMap Overpass' });
    }

    /** Ticketmaster Discovery, only when a key is configured. The key is a query parameter at the edge and is never cached. */
    function ticketmaster(params) {
        if (!tm.enabled || !tm.key) return Promise.reject(new GuideError('fun.guide.disabled', 'Ticketmaster is not configured', { status: 503 }));
        const url = new URL(tm.url);
        const query = new URLSearchParams();
        for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') query.set(k, String(v));
        query.set('apikey', tm.key);
        url.search = query.toString();
        const cacheParams = { ...params };
        const key = `ticketmaster:v1:${sha(JSON.stringify(cacheParams))}`;
        return cached(key, () => fetchJson(url, {}, {
            timeoutMs: tm.timeoutMs, minIntervalMs: tm.minIntervalMs, what: 'Ticketmaster',
        }), { ttlMs: tm.ttlMs, failedWithinMs: 60_000, what: 'Ticketmaster' });
    }

    /** When an OSM answer expires (an ISO time), or null. Used by the page's "cached" note. */
    async function cachedUntil(query) {
        const hit = await cacheGet(`overpass:v1:${sha(query)}`);
        return hit ? hit.expires_at : null;
    }

    return { geocode, overpass, ticketmaster, cacheGet, cachePut, cachedUntil, fetchJson, GuideError };
}

module.exports = { createUpstreams, createPacer, GuideError, sha, keyOf };
