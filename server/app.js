'use strict';

/**
 * OpenVibe.Fun — Express app factory; server/index.js listens, tests build their own instance with a temp database
 * and a mock Network/upstreams.
 *
 *   /, /guide, /quests, /q/:slug, /live, /plans, /p/:slug, /developers   the pages (http/pages.js)
 *   /api/v1/*                                                          the API (http/api.js)
 *   /auth/*                                                            Network SSO with PKCE (auth/sso.js)
 *   /api/health, /api/ready, /release.json, /metrics                   (loopback only)
 *   /internal/events                                                   account export/deletion (loopback only)
 *
 * The chat-vote reader and the OpenCoin retry timer are made here but started by server/index.js (and never under
 * FUN_DRILL); tests drive their runOnce()/retryPending().
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const cache = require('openvibe-shared/cache-policy');

const configLib = require('./config');
const { openStore } = require('./db');
const { createKeyStore } = require('./auth/keys');
const { createSso } = require('./auth/sso');
const { createPrincipal } = require('./http/principal');
const { createApi } = require('./http/api');
const { createSharing } = require('./sharing');
const { createPageRoutes } = require('./http/pages');
const { createServiceReadiness } = require('./observability');
const { assetVersion, send } = require('./render/layout');
const { raw } = require('./render/html');

const accountDataLib = require('./identity/account-data');
const { createStore } = require('./store');
const { createSearchIndex } = require('./search');
const { createSearchRelay } = require('openvibe-publishing/search-relay');
const { createUpstreams } = require('./upstreams');
const { createGuide } = require('./guide');
const { createUpstreams: createGuideUpstreams } = require('./guide/upstream');
const { createCoins } = require('./coins');
const { createChatSync } = require('./chat-sync');
const { createNetworkSender } = require('openvibe-sdk/account-data');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const { createHttpTelemetry } = require('openvibe-sdk/service');
const { createPgTelemetrySink } = require('openvibe-sdk/telemetry');

/**
 * opts: config, store, now (clock), fetchImpl (Network and the public upstreams), log, valkey, accountSend (a
 * stand-in for Network's internal routes; tests only), telemetrySink.
 */
async function createApp(opts = {}) {
    const config = opts.config || configLib.load();
    const log = opts.log || console;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const s = opts.store || await openStore(config, { now: opts.now, log });

    const keys = createKeyStore({ config, fetchImpl, log });
    const sso = createSso({ config, keys, fetchImpl, now: s.now, log });
    const principal = createPrincipal({ config, keys });

    // The queued Search documents (fun_outbox) go to OpenVibe.Search's owner API with this service's token; off
    // without FUN_SEARCH_URL or the client secret. Started by server/index.js, never under FUN_DRILL.
    const searchRelay = createSearchRelay({
        db: s.db, table: 'fun_outbox', owner: 'fun', searchUrl: config.search.url, fetchImpl, now: s.now, log,
        auth: config.search.url && config.oauth.clientSecret ? contracts.serviceAuth.createTokenClient({
            tokenUrl: `${config.networkInternalUrl}/oauth/token`, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
            audience: 'openvibe.search', scope: 'search.document.write', fetchImpl,
        }) : null,
    });
    const search = createSearchIndex({ config, s, onQueued: () => searchRelay.kick() });
    // The one sharing system (design 2026-11-06, step 6): Fun's visibility columns move onto share rows; the column
    // is still written, so an old reader fails closed.
    const sharing = opts.sharing || createSharing({ db: s.db, config, fetchImpl, log });
    const store = createStore(s, { search, config, sharing });
    const upstreams = createUpstreams({ config, fetchImpl, now: s.now, log });
    const guideUpstream = createGuideUpstreams({ config, s, fetchImpl, now: s.now, log });
    const guide = createGuide({ config, s, upstream: guideUpstream, now: s.now, log });
    const coins = createCoins({ config, s, store, fetchImpl, log, now: s.now });
    const chatSync = createChatSync({ config, s, store, upstreams, log, now: s.now });

    // Account export and deletion (ADR-033). The sender posts to Network's internal routes with this service's own
    // client-credentials token; a test injects a stand-in through opts.accountSend.
    const accountData = accountDataLib.create({ db: s.db, log });
    const accountSend = opts.accountSend || (config.oauth.clientSecret
        ? createNetworkSender({ networkInternalUrl: config.networkInternalUrl, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, fetch: fetchImpl })
        : async () => { throw new Error('OV_OAUTH_CLIENT_SECRET is not set: Fun cannot answer account events'); });

    const ctx = {
        config, s, keys, sso, principal, search, searchRelay, store, upstreams, guide, guideUpstream, coins, chatSync,
        accountData, accountSend, sharing, log,
    };

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    const release = require('openvibe-shared/release').createRelease({ service: 'fun', root: path.join(__dirname, '..') });
    require('./render/layout').setRelease(release.release);
    const metrics = require('openvibe-shared/metrics').instrument(app, { service: 'fun', release: release.release });
    app.locals.metrics = metrics.registry;
    ctx.telemetry = createHttpTelemetry({ service: 'fun', sink: opts.telemetrySink || createPgTelemetrySink({ db: s.db, log }), skipPrefixes: ['/shared'], intervalMs: 60_000 });
    app.use(ctx.telemetry.middleware());
    app.locals.ctx = ctx;

    const valkey = opts.valkey !== undefined ? opts.valkey : (config.valkey.url ? require('openvibe-sdk/valkey').createValkey({ url: config.valkey.url, prefix: config.valkey.prefix, log }) : null);
    ctx.valkey = valkey;

    app.use(contracts.http.middleware());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://static.cloudflareinsights.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
                imgSrc: ["'self'", 'data:', 'https://openvibe.network', 'https://openvibe.media'],
                connectSrc: ["'self'", 'https://openvibe.network', 'https://cloudflareinsights.com', 'https://openvibe.live', 'https://openvibe.chat', 'https://openvibe.events'],
                frameSrc: ["'self'", 'https://openvibe.network'],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
            },
        },
        frameguard: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Machine endpoints ───────────────────────────────────
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-fun', name: 'OpenVibe.Fun', version: VERSION }));
    release.mount(app, { registry: metrics.registry });
    const readiness = createServiceReadiness({ s, config, release: release.release, valkey, sso});
    app.get('/api/ready', readiness.handler);

    // ── Who is asking (verified offline; refreshed when expired) ──
    app.use(sso.middleware());

    // ── Sign-in (OAuth2 + PKCE client of OpenVibe.Network) ──
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 60, skip: (req) => req.path === '/me' || req.path === '/navbar-token', standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', sso.routes());
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'fun', service: 'fun', host: 'openvibe.fun', name: 'OpenVibe.Fun', profile: 'ugc' })); }

    // ── OpenVibe.Events → this service (loopback only) ──────
    // Account export/deletion; the consumer reads the raw body itself, so it is mounted before any body parser.
    // nginx answers 404 for /internal/.
    app.use('/internal/events', accountData.consumer({
        secrets: config.events.secrets,
        send: accountSend,
        now: s.now,
        onEvent: async (ev) => `ignored:${ev.event_type}`,
    }));

    // ── Static assets (content-hashed ?v= → immutable) ──────
    app.use('/shared', require('openvibe-shared/serve').handler());
    // ── /api/v1/{quest,plan}/:slug/share — the one Share sheet's API (openvibe-sdk/share) ──
    // GET/PUT .../share, .../share/requests, .../share/transfer[/accept|decline|cancel], GET /api/v1/share/people
    // and /api/v1/shared-with-me. Access is still decided by canView on every read path; the router answers only its
    // own paths. The sheet is a browser, so it presents the session cookie (req.viewer).
    {
        const shareApi = express.Router();
        shareApi.use(sharing.shares.router({
            service: 'fun',
            authenticate: (req) => sharing.shareViewer(req.viewer),
            describe: sharing.describe,
        }));
        const SHARE_PATH = /^\/api\/v1\/(?:shared-with-me$|share\/people$|[^/]+\/[^/]+\/share(?:\/|$))/;
        app.use((req, res, next) => (SHARE_PATH.test(req.path) ? shareApi(req, res, next) : next()));
    }
    // Expire members and transfers and send queued share events/notifications. Unref'd: it never holds a test open.
    if (opts.startSharingWorker !== false) {
        const timer = setInterval(() => { sharing.work().catch(() => { /* logged inside */ }); }, 15_000);
        if (timer.unref) timer.unref();
        app.locals.sharingTimer = timer;
    }
    app.use(express.static(PUBLIC_DIR, {
        index: false, redirect: false,
        setHeaders(res, filePath) {
            const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
            const v = res.req && res.req.query && res.req.query.v;
            res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: !!v && v === assetVersion(rel) }));
        },
    }));

    // ── API ─────────────────────────────────────────────────
    app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: Number(process.env.FUN_API_RATE_LIMIT_PER_MIN) || 240, standardHeaders: true, legacyHeaders: false, handler: (req, res) => contracts.http.sendProblem(res, 429, 'rate_limited', { detail: 'too many requests from this address; retry shortly', ctx: req.ov }) }));
    app.use('/api/v1', createApi(ctx));
    // GET /openapi.json (SEO-3): the API as OpenAPI 3.1. It is not in openvibe-contracts, so the document is read from
    // the routes this app mounts under /api/, with the summaries the API files' header comments give them
    // (server/http/openapi-routes.js).
    {
        const d = require('./agent-descriptor');
        const site = String(config.baseUrl).replace(/\/+$/, '');
        app.get('/openapi.json', require('./http/openapi-routes').openapiRoute(app, {
            title: `${d.name} API`, description: d.purpose, version: require('../package.json').version, baseUrl: site,
            docs: `${site}/developers`,
            files: ['http/api.js'].map((f) => require('path').join(__dirname, f)),
        }));
    }
    app.use('/api', (req, res) => contracts.http.sendProblem(res, 404, 'route.not_found', { detail: 'No such API route', ctx: req.ov }));

    // ── Pages ───────────────────────────────────────────────
    app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.FUN_RATE_LIMIT_PER_MIN) || 300, standardHeaders: true, legacyHeaders: false }));
    // ── Agent layer (openvibe-shared/agent-layer) ───────────
    // The manifest and the Markdown twins of the public pages. Gated to twin requests only, so a browser and a
    // page drawn for a signed-in person always reach the site's own routes; the twin renderer is signed out.
    {
        const agentLayer = require('openvibe-shared/agent-layer');
        const agent = express.Router();
        agent.use((req, _res, next) => {
            const twinPath = req.path.endsWith('.md');
            const twinFormat = req.query.format === 'markdown';
            const twinAccept = !!(req.headers.accept && req.accepts(['html', 'text/markdown']) === 'text/markdown');
            if (req.path === '/.well-known/agent.json' || twinPath || twinFormat || twinAccept) return next();
            return next('router');
        });
        agentLayer.mount(agent, { descriptor: require('./agent-descriptor'), render: require('./agent-pages').createAgentPages(ctx).renderPublicPage });
        app.use(agent);
    }
    app.use(require('./places/lists').createPlaceListRoutes(ctx));
    app.use(createPageRoutes(ctx));
    app.use((req, res) => send(res, 404, {
        viewer: req.viewer, config, path: req.originalUrl, title: 'Not found',
        body: raw(require('./views').notFound()),
    }));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        log.error('[OpenVibe.Fun]', err && err.message ? err.message.slice(0, 300) : err);
        if (res.headersSent) return;
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        if (err && err.type === 'entity.parse.failed') return contracts.http.sendProblem(res, 400, 'request.malformed_json', { ctx: req.ov });
        if (err && err.type === 'entity.too.large') return req.path.startsWith('/api/') ? contracts.http.sendProblem(res, 413, 'request.too_large', { ctx: req.ov }) : res.status(413).type('text/plain').send('That request was too large.');
        if (req.path.startsWith('/api/')) return contracts.http.sendProblem(res, 500, 'internal.error', { detail: 'Internal error', ctx: req.ov });
        res.status(500).type('text/plain').send('Something went wrong on our side. Try again in a moment.');
    });

    return { app, ctx };
}

module.exports = { createApp };
