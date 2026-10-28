'use strict';

/**
 * In-process stand-ins for OpenVibe.Live, OpenVibe.Chat, OpenVibe.Today, Nominatim, Overpass and Ticketmaster on one
 * HTTP server. The boot helper points every URL at it.
 *
 * Defaults: Live channel @ada is live; two public chat lines; a Portland geocode; four OSM elements (museum, park,
 * café, playground); one Ticketmaster event; Today records an event and answers 201.
 *
 * A test changes state.channels / state.messages / state.elements / state.ticketmaster and reads state.requests
 * (headers included) to check the User-Agent, caching and the one Today write.
 */
const http = require('http');

const DEFAULT_CHANNELS = {
    ada: { display_name: 'Ada', live: true, streams: [{ title: 'IRL Saturday', viewer_count: 42 }] },
    bo: { display_name: 'Bo', live: false, streams: [] },
};

const DEFAULT_MESSAGES = [
    { id: 100, username: 'kim', channel: 'ada', message: 'hello', is_deleted: 0, timestamp: '2026-10-28 10:00:00' },
    { id: 101, username: 'kim', channel: 'ada', message: '!quest vote find-the-best-bench', is_deleted: 0, timestamp: '2026-10-28 10:01:00' },
    { id: 102, username: 'bo', channel: 'ada', message: '!quest suggest Find a mural nobody has shown chat', is_deleted: 0, timestamp: '2026-10-28 10:02:00' },
    { id: 103, username: 'zoe', channel: 'ada', message: '!quest verify find-the-best-bench', is_deleted: 0, timestamp: '2026-10-28 10:03:00' },
    { id: 104, username: 'deleted_user', channel: 'ada', message: '!quest suggest something unsafe', is_deleted: 1, timestamp: '2026-10-28 10:04:00' },
];

const DEFAULT_GEOCODE = {
    portland: { lat: 45.5152, lon: -122.6784, display_name: 'Portland, Multnomah County, Oregon, United States' },
    seattle: { lat: 47.6062, lon: -122.3321, display_name: 'Seattle, King County, Washington, United States' },
};

const DEFAULT_ELEMENTS = [
    { type: 'node', id: 1, lat: 45.517, lon: -122.68, tags: { name: 'City Museum', tourism: 'museum', wheelchair: 'yes', opening_hours: 'Tu-Su 10:00-17:00', website: 'https://museum.example/' } },
    { type: 'node', id: 2, lat: 45.519, lon: -122.676, tags: { name: 'Riverside Park', leisure: 'park', wheelchair: 'no', fee: 'no' } },
    { type: 'way', id: 3, center: { lat: 45.512, lon: -122.674 }, tags: { name: 'Rainy Day Café', amenity: 'cafe', wheelchair: 'yes', fee: 'yes', opening_hours: 'Mo-Fr 08:00-18:00' } },
    { type: 'node', id: 4, lat: 45.52, lon: -122.67, tags: { name: 'Playground', leisure: 'playground', wheelchair: 'yes', fee: 'no' } },
];

const DEFAULT_TICKETMASTER = [
    {
        id: 'tm1', name: 'Night Market', url: 'https://www.ticketmaster.com/event/tm1',
        dates: { start: { localDate: '2026-11-01', localTime: '19:00:00', dateTime: '2026-11-01T19:00:00Z' }, timezone: 'America/Los_Angeles' },
        _embedded: { venues: [{ name: 'Hall', city: { name: 'Portland' }, address: { line1: '1 Main St' }, location: { latitude: 45.52, longitude: -122.67 } }] },
        classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }],
        info: 'An all-ages night market.',
    },
];

function listen(handler) {
    return new Promise((resolve) => {
        const sockets = new Set();
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                const json = (status, obj, headers = {}) => {
                    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                    res.end(JSON.stringify(obj));
                };
                Promise.resolve(handler(req, raw, json, res)).catch((err) => json(500, { error: String(err && err.message) }));
            });
        });
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        server.listen(0, '127.0.0.1', () => resolve({
            server, url: `http://127.0.0.1:${server.address().port}`,
            close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }),
        }));
    });
}

async function startUpstreams() {
    const state = {
        channels: JSON.parse(JSON.stringify(DEFAULT_CHANNELS)),
        messages: DEFAULT_MESSAGES.map((m) => ({ ...m })),
        geocode: { ...DEFAULT_GEOCODE },
        elements: JSON.parse(JSON.stringify(DEFAULT_ELEMENTS)),
        ticketmaster: JSON.parse(JSON.stringify(DEFAULT_TICKETMASTER)),
        todayEvents: [],
        todayStatus: 201,
        requests: [],
    };

    const srv = await listen(async (req, raw, json, res) => {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        state.requests.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), headers: { ...req.headers }, body: raw });

        const live = p.match(/^\/api\/streams\/channel\/([^/]+)\/live$/);
        if (live) {
            const username = decodeURIComponent(live[1]);
            const ch = state.channels[username];
            if (!ch) return json(404, { error: 'Channel not found' });
            return json(200, { channel: { username, display_name: ch.display_name, user_id: 7 }, streams: ch.live ? ch.streams : [] });
        }

        if (p === '/api/chat/global/history') {
            const username = String(url.searchParams.get('username') || '');
            const afterId = url.searchParams.get('after_id');
            const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
            let list = state.messages.filter((m) => !username || m.channel === username || m.username === username);
            if (afterId != null) list = list.filter((m) => Number(m.id) > Number(afterId));
            list = [...list].sort((a, b) => Number(a.id) - Number(b.id)).slice(0, limit);
            return json(200, { messages: list, latest_id: list.length ? list[list.length - 1].id : null });
        }

        if (p === '/api/v1/events' && req.method === 'POST') {
            const auth = String(req.headers.authorization || '');
            const body = JSON.parse(raw || '{}');
            if (!auth.startsWith('Bearer ')) return json(401, { code: 'today.sign_in_required', message: 'token required' });
            if (state.todayStatus >= 400) return json(state.todayStatus, { code: 'today.refused', message: 'Today refused this event' });
            const id = `evt_test_${state.todayEvents.length + 1}`;
            state.todayEvents.push({ id, auth, idempotency_key: req.headers['idempotency-key'] || null, body });
            return json(201, { id, kind: body.kind, title: body.title, starts_at: body.starts_at }, { Location: `/api/v1/events/${id}` });
        }

        if (p === '/search') {
            const q = String(url.searchParams.get('q') || '').toLowerCase();
            if (q === 'nowhere') return json(200, []);
            const hit = state.geocode[q] || state.geocode[q.split(',')[0]] || null;
            return json(200, hit ? [hit] : []);
        }

        if (p === '/interpreter' || p === '/api/interpreter') {
            return json(200, { elements: state.elements, version: 0.6 });
        }

        if (p === '/discovery/v2/events.json') {
            return json(200, { _embedded: { events: state.ticketmaster }, page: { size: 20, totalElements: state.ticketmaster.length } });
        }

        return json(404, { error: 'not found' });
    });

    return {
        url: srv.url,
        state,
        close: srv.close,
        requestsFor(path) { return state.requests.filter((r) => r.path === path); },
        lastFor(path) { return state.requests.filter((r) => r.path === path).pop() || null; },
        setChannel(username, ch) { state.channels[username] = ch; },
        addMessage(m) { state.messages.push(m); },
    };
}

module.exports = {
    startUpstreams, DEFAULT_CHANNELS, DEFAULT_MESSAGES, DEFAULT_GEOCODE, DEFAULT_ELEMENTS, DEFAULT_TICKETMASTER,
};
