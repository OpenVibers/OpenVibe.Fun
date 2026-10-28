'use strict';

/**
 * "What's fun near me": places from OpenStreetMap through Overpass, bounded to one radius and one small set of tags.
 * The shapes are the ones Food/Tools use for OSM places; the filters are Fun's own (outside, inside for a rainy day,
 * arts, food, kids, accessible, cheap). Everything returned is © OpenStreetMap contributors, ODbL 1.0, and every
 * caller shows the attribution.
 */
const { GuideError } = require('./upstream');

const ATTRIBUTION = {
    text: '© OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL 1.0',
    license_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
};
const SOURCE = {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/',
    via: 'Overpass API',
    license: 'ODbL 1.0',
    fetched_note: 'fetched by OpenVibe.Fun and cached for 7 days',
};

const KINDS = Object.freeze(['all', 'outside', 'inside', 'arts', 'food']);
const TYPE_LABEL = {
    attraction: 'Attraction', museum: 'Museum', gallery: 'Gallery', viewpoint: 'Viewpoint', zoo: 'Zoo',
    theme_park: 'Theme park', artwork: 'Public art', park: 'Park', playground: 'Playground',
    miniature_golf: 'Mini golf', water_park: 'Water park', bowling_alley: 'Bowling', sports_centre: 'Sports centre',
    amusement_arcade: 'Arcade', cinema: 'Cinema', theatre: 'Theatre', planetarium: 'Planetarium',
    arts_centre: 'Arts centre', cafe: 'Café', restaurant: 'Restaurant', pub: 'Pub', bar: 'Bar', ice_cream: 'Ice cream',
};
const INDOOR = new Set(['museum', 'gallery', 'cinema', 'theatre', 'planetarium', 'arts_centre', 'bowling_alley', 'amusement_arcade', 'cafe', 'restaurant', 'pub', 'bar', 'ice_cream']);
const FAMILY = new Set(['zoo', 'theme_park', 'playground', 'water_park', 'miniature_golf', 'bowling_alley', 'amusement_arcade', 'museum', 'cinema']);

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

function haversineKm(aLat, aLon, bLat, bLon) {
    const R = 6371.0088;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function safeUrl(v) {
    if (typeof v !== 'string' || !v.trim()) return null;
    try {
        const u = new URL(v.trim());
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
}

function formatAddress(tags) {
    return [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:state'], tags['addr:postcode']]
        .map((p) => (p == null ? '' : String(p).trim())).filter(Boolean).join(', ') || null;
}

function typeOf(tags) {
    return tags.tourism || tags.leisure || tags.amenity || 'place';
}

/** The Overpass query for the selected filters, always an around: radius and a single out center tags. */
function queryFor({ kind = 'all', kids = false, rainy = false } = {}, lat, lon, radiusM) {
    const around = `(around:${Math.round(radiusM)},${lat},${lon})`;
    const clauses = new Set();
    const add = (tag, values) => {
        for (const value of values) clauses.add(`nwr["${tag}"="${value}"]${around};`);
    };
    if (kind === 'all' || kind === 'outside') {
        add('tourism', ['attraction', 'viewpoint', 'zoo', 'theme_park', 'artwork']);
        add('leisure', ['park', 'playground', 'miniature_golf', 'water_park', 'sports_centre', 'bowling_alley']);
    }
    if (kind === 'all' || kind === 'inside' || rainy) {
        add('tourism', ['museum', 'gallery']);
        add('amenity', ['cinema', 'theatre', 'arts_centre', 'planetarium']);
        add('leisure', ['bowling_alley', 'amusement_arcade']);
    }
    if (kind === 'arts') {
        add('tourism', ['artwork', 'gallery', 'museum']);
        add('amenity', ['arts_centre', 'theatre']);
    }
    if (kind === 'food') add('amenity', ['cafe', 'restaurant', 'pub', 'bar', 'ice_cream']);
    if (kids) {
        add('tourism', ['zoo', 'theme_park']);
        add('leisure', ['playground', 'water_park', 'miniature_golf']);
    }
    // A filter that somehow selected nothing still gets a safe, tiny query rather than an unbounded one.
    if (!clauses.size) add('tourism', ['attraction']);
    return `[out:json][timeout:25];(\n${[...clauses].join('\n')}\n);out center tags;`;
}

/** One Overpass element → one result, or null when it is not a usable place. */
function toResult(el, origin, { kind = 'all', kids = false, rainy = false, cheap = false, accessible = false } = {}) {
    const lat = el.lat != null ? Number(el.lat) : (el.center && Number(el.center.lat));
    const lon = el.lon != null ? Number(el.lon) : (el.center && Number(el.center.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const tags = el.tags || {};
    const type = typeOf(tags);
    if (kind === 'food' && !['cafe', 'restaurant', 'pub', 'bar', 'ice_cream'].includes(type)) return null;
    const indoor = tags.indoor === 'yes' || INDOOR.has(type);
    const family = FAMILY.has(type) || tags.family === 'yes';
    const wheelchair = tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : null;
    if (rainy && !indoor) return null;
    if (kids && !family) return null;
    if (accessible && wheelchair !== true) return null;
    if (cheap && tags.fee === 'yes') return null;
    return {
        id: `osm-${el.type}-${el.id}`,
        osm_type: el.type,
        osm_id: el.id,
        osm_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        kind: 'place',
        type,
        type_label: TYPE_LABEL[type] || type.replace(/_/g, ' '),
        name: tags.name || tags.operator || (TYPE_LABEL[type] || 'A place'),
        lat, lon,
        distance_km: Math.round(haversineKm(origin.lat, origin.lon, lat, lon) * 10) / 10,
        address: formatAddress(tags),
        opening_hours: tags.opening_hours || null,
        website: safeUrl(tags.website || tags['contact:website'] || tags.url),
        phone: tags.phone || tags['contact:phone'] || null,
        wheelchair,
        indoor,
        family,
        fee: tags.fee === 'no' ? false : tags.fee === 'yes' ? true : null,
        map_url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
    };
}

function elementsToResults(elements, origin, filters, limit) {
    const seen = new Set();
    const out = [];
    for (const el of elements || []) {
        const r = toResult(el, origin, filters);
        if (!r) continue;
        const key = `${r.name.toLowerCase()}@${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    out.sort((a, b) => a.distance_km - b.distance_km || a.name.localeCompare(b.name));
    return limit ? out.slice(0, limit) : out;
}

function radiusMetres(radiusKm, config) {
    const max = (config && config.osm.maxRadiusKm) || 25;
    return Math.round(clamp(Number(radiusKm) || (config && config.osm.defaultRadiusKm) || 5, 0.5, max) * 1000);
}

/**
 * The place search behind GET /api/v1/guide and /guide. A name is geocoded once through Nominatim; the area query
 * is cached through Overpass. Throws GuideError (fun.guide.invalid on bad input, fun.guide.not_found on an unknown
 * place, fun.guide.upstream when OSM cannot be reached).
 */
async function searchPlaces(upstream, { q = null, lat = null, lon = null, radiusKm = null, kind = 'all', kids = false, rainy = false, cheap = false, accessible = false, limit = null } = {}, config) {
    const k = String(kind || 'all');
    if (!KINDS.includes(k)) throw new GuideError('fun.guide.invalid', `kind: ${KINDS.join(', ')}`, { status: 422 });
    let place = null;
    if (lat != null && lat !== '' && lon != null && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        const la = Number(lat); const lo = Number(lon);
        if (la < -90 || la > 90 || lo < -180 || lo > 180) throw new GuideError('fun.guide.invalid', 'lat and lon must be a real point', { status: 422 });
        place = { name: null, display_name: null, lat: la, lon: lo, from: 'coordinates' };
    } else if (q && String(q).trim()) {
        const g = await upstream.geocode(q, { limit: 1 });
        const hit = Array.isArray(g.body) ? g.body[0] : null;
        if (!hit) throw new GuideError('fun.guide.not_found', `no place called “${String(q).slice(0, 80)}”; try a town and region, or a postcode`, { status: 404 });
        const la = Number(hit.lat); const lo = Number(hit.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new GuideError('fun.guide.upstream', 'OpenStreetMap gave no coordinates for that place');
        place = { name: String(q).trim(), display_name: hit.display_name || String(q), lat: la, lon: lo, from: 'geocode', geocoded_at: g.fetched_at, geocode_cached: g.cached };
    } else {
        throw new GuideError('fun.guide.invalid', 'q: a place to search for (or lat and lon)', { status: 422 });
    }

    const radiusM = radiusMetres(radiusKm, config);
    const filters = { kind: k, kids: Boolean(kids), rainy: Boolean(rainy), cheap: Boolean(cheap), accessible: Boolean(accessible) };
    const query = queryFor(filters, place.lat, place.lon, radiusM);
    const answer = await upstream.overpass(query);
    const cap = clamp(Number(limit) || (config && config.osm.maxResults) || 30, 1, (config && config.osm.maxResults) || 30);
    const results = elementsToResults(answer.body && answer.body.elements, place, filters, cap);
    return {
        location: place,
        filters,
        radius_km: radiusM / 1000,
        results,
        counts: { total: results.length, accessible: results.filter((r) => r.wheelchair === true).length, indoor: results.filter((r) => r.indoor).length },
        query,
        fetched_at: answer.fetched_at,
        cached: Boolean(answer.cached),
        stale: Boolean(answer.stale),
        attribution: ATTRIBUTION,
        source: SOURCE,
    };
}

module.exports = {
    searchPlaces, queryFor, toResult, elementsToResults, radiusMetres, haversineKm, safeUrl, typeOf,
    ATTRIBUTION, SOURCE, KINDS, TYPE_LABEL, INDOOR, FAMILY,
};
