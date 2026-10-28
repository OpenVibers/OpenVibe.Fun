'use strict';

/**
 * The one body Fun sends to OpenVibe.Today's public event API. It is the person's own event, created with their own
 * Network token; the title and description are the plan's public words, never a look description, and the link back
 * is the plan page. No service token, no calendar fan-out.
 */
function planEvent(config, plan, winner) {
    const start = new Date(plan.starts_at);
    return {
        kind: 'event',
        title: `Fun: ${plan.title}`.slice(0, 120),
        description: `${winner.title}${winner.place_name ? ` at ${winner.place_name}` : ''}. Chosen on OpenVibe.Fun: ${String(config.baseUrl).replace(/\/+$/, '')}/plans/${plan.slug}`.slice(0, 1000),
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 2 * 60 * 60_000).toISOString(),
        tz: plan.timezone,
        visibility: 'public',
    };
}

module.exports = { planEvent };
