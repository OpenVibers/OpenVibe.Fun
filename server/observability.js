'use strict';

/**
 * Truthful readiness for GET /api/ready (openvibe-shared/ready): the database is required; the Network signing key,
 * the OAuth client, Valkey and the optional guide/coins upstreams are optional. The key store is warmed right after
 * listen, so a service nobody has signed in to yet is not degraded only because the first fetch had not happened.
 */
const { jwksStatus } = require('openvibe-sdk/auth');
const { createReadiness } = require('openvibe-shared/ready');

function createServiceReadiness({ s, config, valkey = null, release = null }) {
    return createReadiness({
        service: 'fun',
        release,
        checks: [
            {
                name: 'db', required: true,
                check: async () => {
                    const r = await s.db.ready();
                    return r.ok ? { ok: true, detail: r.detail } : r.error;
                },
            },
            { name: 'valkey', required: false, check: async () => (valkey ? valkey.ready() : { skipped: 'VALKEY_URL not set: per-caller limits count in this process only' }) },
            {
                name: 'network_jwks', required: false,
                check: () => {
                    const statuses = jwksStatus();
                    if (!statuses.length) return 'no JWKS clients (misconfigured)';
                    const first = statuses[0];
                    if (!first.ready) return 'Network signing key not loaded yet: sign-in and the API are unavailable';
                    return { ok: true, detail: { keys: first.keys, failures: first.failures, stale: first.stale, fetched_at: first.fetchedAt } };
                },
            },
            { name: 'oauth_client', required: false, check: () => (config.oauth.clientSecret ? true : 'OV_OAUTH_CLIENT_SECRET unset: sign-in cannot complete') },
            { name: 'ticketmaster', required: false, check: () => (config.ticketmaster.enabled ? true : { skipped: 'TICKETMASTER_API_KEY unset: the guide uses OpenStreetMap only' }) },
            { name: 'coins', required: false, check: () => (config.coins.mode === 'on' ? (config.oauth.clientSecret ? true : 'FUN_COINS=on but OV_OAUTH_CLIENT_SECRET is unset') : { skipped: 'FUN_COINS is off: badges are paid, OpenCoins are not credited' }) },
        ],
    });
}

module.exports = { createServiceReadiness };
