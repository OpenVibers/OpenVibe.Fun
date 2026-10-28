'use strict';

/**
 * OpenVibe.Fun configuration. Every value comes from the environment (production: /etc/openvibe/fun.env,
 * see .env.example). Only environment variable NAMES appear in code and docs; secrets are never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();
const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
const bool = (v, def = false) => (v == null || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 5140);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.fun' : `http://localhost:${port}`));
    const networkUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');
    const ticketmasterKey = String(env.TICKETMASTER_API_KEY || env.FUN_TICKETMASTER_API_KEY || '').trim();

    return {
        service: 'fun',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,
        drill: bool(env.FUN_DRILL),
        limits: {
            minute: Math.max(1, int(env.FUN_LIMITS_MINUTE, 120)),
            hour: Math.max(1, int(env.FUN_LIMITS_HOUR, 3000)),
        },

        // PostgreSQL (ADR-035): DATABASE_URL serves (PgBouncer), DATABASE_DIRECT_URL migrates (owner role). In
        // development without DATABASE_URL an embedded PGlite database in data/pglite is used.
        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.FUN_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:fun:' },

        // OpenVibe.Network: SSO (OAuth2 authorization server with PKCE), JWKS and (when on) OpenCoins.
        networkUrl,
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkUrl),
        audience: env.FUN_AUDIENCE || 'openvibe.fun',
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'fun',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        // OpenVibe.Events → this service's account export/deletion route. The secret signs a delivery
        // (comma-separated for rotation, 32+ characters each); unset turns POST /internal/events off (503).
        events: {
            secrets: String(env.FUN_EVENTS_SECRET || '').split(',').map((x) => x.trim()).filter(Boolean),
            url: trim(env.FUN_EVENTS_URL || env.EVENTS_URL || ''),
            endpoint: env.FUN_EVENTS_ENDPOINT || '',
            intervalMs: Math.max(500, int(env.FUN_EVENTS_INTERVAL_MS, 5000)),
            scope: env.FUN_EVENTS_SCOPE || 'events.subscription.manage',
        },

        // The public APIs Fun reads: Live's channel status, Chat's public history (chat votes are read, never
        // posted), and Today's public event API (called with the viewer's own Network token, never a service one).
        upstreams: {
            live: trim(env.OV_LIVE_URL || 'https://openvibe.live'),
            chat: trim(env.OV_CHAT_URL || 'https://openvibe.chat'),
            today: trim(env.OV_TODAY_URL || 'https://openvibe.today'),
            timeoutMs: Math.max(500, int(env.FUN_UPSTREAM_TIMEOUT_MS, 8000)),
        },

        // OpenStreetMap: the same two community hosts Food uses, with the same obligations — identify every request,
        // pace it, cache the answer, and keep a bounded around: query. Ticketmaster is off unless a key is configured.
        osm: {
            nominatimUrl: trim(env.FUN_NOMINATIM_URL || 'https://nominatim.openstreetmap.org'),
            overpassUrl: trim(env.FUN_OVERPASS_URL || 'https://overpass-api.de/api/interpreter'),
            userAgent: env.FUN_OSM_USER_AGENT || `OpenVibeFun/0.1 (+${baseUrl}; contact@openvibe.network)`,
            email: String(env.FUN_OSM_EMAIL || '').trim(),
            minIntervalMs: Math.max(0, int(env.FUN_OSM_MIN_INTERVAL_MS, 1000)),
            timeoutMs: Math.max(1000, int(env.FUN_OSM_TIMEOUT_MS, 20_000)),
            retryAfterMs: Math.max(0, int(env.FUN_OSM_RETRY_AFTER_MS, 120_000)),
            cacheTtlMs: Math.max(60_000, int(env.FUN_GEO_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000)),
            staleTtlMs: Math.max(60_000, int(env.FUN_GEO_STALE_TTL_MS, 30 * 24 * 60 * 60 * 1000)),
            defaultRadiusKm: Math.min(50, Math.max(1, int(env.FUN_GUIDE_RADIUS_KM, 5))),
            maxRadiusKm: Math.min(50, Math.max(1, int(env.FUN_GUIDE_MAX_RADIUS_KM, 25))),
            maxResults: Math.min(60, Math.max(1, int(env.FUN_GUIDE_MAX_RESULTS, 30))),
        },
        ticketmaster: {
            key: ticketmasterKey,
            enabled: Boolean(ticketmasterKey),
            url: trim(env.FUN_TICKETMASTER_URL || 'https://app.ticketmaster.com/discovery/v2/events.json'),
            minIntervalMs: Math.max(0, int(env.FUN_TICKETMASTER_MIN_INTERVAL_MS, 1000)),
            timeoutMs: Math.max(1000, int(env.FUN_TICKETMASTER_TIMEOUT_MS, 8000)),
            ttlMs: Math.max(60_000, int(env.FUN_TICKETMASTER_TTL_MS, 15 * 60_000)),
            staleTtlMs: Math.max(60_000, int(env.FUN_TICKETMASTER_STALE_TTL_MS, 24 * 60 * 60_000)),
            radiusKm: Math.min(100, Math.max(1, int(env.FUN_TICKETMASTER_RADIUS_KM, 10))),
            size: Math.min(50, Math.max(1, int(env.FUN_TICKETMASTER_SIZE, 12))),
        },

        // IRL quests: a chat verification needs this many distinct chat votes; a suggestion list is capped per board.
        quests: {
            verifyVotes: Math.max(1, int(env.FUN_QUEST_VERIFY_VOTES, 3)),
            maxSuggestions: Math.min(100, Math.max(1, int(env.FUN_QUEST_MAX_SUGGESTIONS, 30))),
            coins: Math.min(500, Math.max(0, int(env.FUN_QUEST_COINS, 25))),
            syncIntervalMs: Math.max(15_000, int(env.FUN_CHAT_SYNC_INTERVAL_MS, 60_000)),
            syncLimit: Math.min(500, Math.max(1, int(env.FUN_CHAT_SYNC_LIMIT, 200))),
        },

        // OpenCoins are loyalty points, never money. Off by default; when on, Fun asks Network for a credit with
        // its own service token (identity.subject.resolve, network.coins.credit) and the same caps Quest uses.
        coins: {
            mode: bool(env.FUN_COINS) ? 'on' : 'off',
            dailyCap: Math.max(0, int(env.FUN_COINS_DAILY_CAP, 50)),
            globalDailyCap: Math.max(0, int(env.FUN_COINS_GLOBAL_DAILY_CAP, 5000)),
            retryMs: Math.max(30_000, int(env.FUN_COINS_RETRY_MS, 5 * 60_000)),
        },
    };
}

module.exports = { load };
