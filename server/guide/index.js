'use strict';

/**
 * The local guide: OpenStreetMap places first, Ticketmaster events when a key is configured, and nothing else. This
 * is deterministic in v1 — a short, checked set of filters, no model call, no new AI capability. The page shows a
 * map link, opening hours/times and public links, and every answer carries OSM's attribution.
 */
const { searchPlaces } = require('./places');
const { searchEvents } = require('./events');

function createGuide({ config, s, upstream, now = () => Date.now(), log = console }) {
    async function search(params = {}) {
        const places = await searchPlaces(upstream, params, config);
        let events = { configured: Boolean(config.ticketmaster.enabled), events: [], source: null };
        let eventsError = null;
        if (config.ticketmaster.enabled) {
            try {
                events = await searchEvents({
                    city: places.location.name || (places.location.display_name || '').split(',')[0] || null,
                    lat: places.location.lat,
                    lon: places.location.lon,
                    radiusKm: places.radius_km,
                    size: config.ticketmaster.size,
                    start: new Date(Math.floor(now() / 3_600_000) * 3_600_000).toISOString(),
                    end: new Date(Math.floor(now() / 3_600_000) * 3_600_000 + 30 * 86_400_000).toISOString(),
                }, { config, upstream });
            } catch (err) {
                eventsError = String((err && err.message) || err).slice(0, 200);
                log.warn(`[OpenVibe.Fun] Ticketmaster unavailable: ${eventsError}`);
            }
        }
        return {
            ...places,
            events: events.events || [],
            events_configured: Boolean(config.ticketmaster.enabled),
            events_error: eventsError,
            ticketmaster: events.source || null,
        };
    }
    return { search, ATTRIBUTION: require('./places').ATTRIBUTION };
}

module.exports = { createGuide };
