'use strict';

/**
 * Ticketmaster Discovery, off unless TICKETMASTER_API_KEY is configured. It is a free API for event discovery;
 * Fun never sells a ticket, never takes a payment and never calls a paid provider. The events are a second source
 * beside OpenStreetMap: a name, a venue, local times and a public link. An event description is never passed
 * through a look description and no image is proxied; the link goes to Ticketmaster.
 */
const { GuideError } = require('./upstream');

const SOURCE = {
    name: 'Ticketmaster',
    url: 'https://www.ticketmaster.com/',
    via: 'Discovery API v2',
    fetched_note: 'fetched by OpenVibe.Fun and cached for 15 minutes',
};

const safeUrl = (v) => {
    if (typeof v !== 'string' || !v.trim()) return null;
    try { const u = new URL(v.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
};

const clean = (v, n = 300) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) || null;

function dateOf(ev) {
    const d = ev && ev.dates && ev.dates.start ? ev.dates.start : {};
    if (d.dateTime) {
        const t = new Date(d.dateTime);
        if (!Number.isNaN(t.getTime())) return { starts_at: t.toISOString(), local_date: d.localDate || null, local_time: d.localTime || null, timezone: ev.dates.timezone || null };
    }
    if (d.localDate) {
        const t = new Date(`${d.localDate}T${d.localTime || '00:00:00'}Z`);
        if (!Number.isNaN(t.getTime())) return { starts_at: t.toISOString(), local_date: d.localDate, local_time: d.localTime || null, timezone: ev.dates.timezone || null };
    }
    return null;
}

/** One Discovery event → Fun's wire shape. Missing pieces are omitted, never invented. */
function eventOf(ev) {
    if (!ev || !ev.name) return null;
    const when = dateOf(ev);
    const venue = ev._embedded && Array.isArray(ev._embedded.venues) ? ev._embedded.venues[0] : null;
    const classification = ev.classifications && ev.classifications[0] ? ev.classifications[0] : null;
    const segment = classification && classification.segment ? clean(classification.segment.name, 80) : null;
    const genre = classification && classification.genre ? clean(classification.genre.name, 80) : null;
    return {
        id: `tm-${String(ev.id || '').slice(0, 80)}`,
        kind: 'event',
        source: 'ticketmaster',
        name: clean(ev.name, 200),
        url: safeUrl(ev.url),
        ...(when || {}),
        venue: venue ? clean(venue.name, 160) : null,
        city: venue && venue.city ? clean(venue.city.name, 120) : null,
        address: venue && venue.address ? clean(venue.address.line1, 200) : null,
        lat: venue && venue.location && Number.isFinite(Number(venue.location.latitude)) ? Number(venue.location.latitude) : null,
        lon: venue && venue.location && Number.isFinite(Number(venue.location.longitude)) ? Number(venue.location.longitude) : null,
        segment,
        genre,
        info: clean(ev.info, 500),
        map_url: venue && venue.location && Number.isFinite(Number(venue.location.latitude)) && Number.isFinite(Number(venue.location.longitude))
            ? `https://www.openstreetmap.org/?mlat=${venue.location.latitude}&mlon=${venue.location.longitude}#map=16/${venue.location.latitude}/${venue.location.longitude}`
            : null,
    };
}

async function searchEvents({ city = null, lat = null, lon = null, radiusKm = null, size = null, start = null, end = null } = {}, { config, upstream }) {
    if (!config.ticketmaster.enabled) return { configured: false, events: [], source: SOURCE };
    const params = {
        size: Math.min(50, Math.max(1, Number(size) || config.ticketmaster.size)),
        sort: 'date,asc',
        locale: '*',
    };
    const radius = Math.min(100, Math.max(1, Number(radiusKm) || config.ticketmaster.radiusKm));
    if (lat != null && lat !== '' && lon != null && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        params.latlong = `${Number(lat)},${Number(lon)}`;
        params.radius = String(Math.round(radius * 0.621371));
        params.unit = 'miles';
    } else if (city) {
        params.city = String(city).slice(0, 120);
        params.radius = String(Math.round(radius * 0.621371));
        params.unit = 'miles';
    } else {
        throw new GuideError('fun.guide.invalid', 'Ticketmaster needs a city or a point', { status: 422 });
    }
    if (start) params.startDateTime = new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (end) params.endDateTime = new Date(end).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const answer = await upstream.ticketmaster(params);
    const list = answer.body && answer.body._embedded && Array.isArray(answer.body._embedded.events) ? answer.body._embedded.events : [];
    return {
        configured: true,
        events: list.map(eventOf).filter(Boolean),
        fetched_at: answer.fetched_at,
        cached: Boolean(answer.cached),
        stale: Boolean(answer.stale),
        source: SOURCE,
    };
}

module.exports = { searchEvents, eventOf, dateOf, SOURCE };
