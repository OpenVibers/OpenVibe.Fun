'use strict';

/**
 * "Remind me" on a plan's start (plan L48 R3): a link to openvibe.today/remind that sets a one-off reminder for the
 * moment the plan starts. The person signs in there, picks how long before, and it reaches them in the bell and as a
 * push on every OpenVibe site.
 *
 * The link is only there when the start is still ahead: a plan that has started, gets none.
 */
const kit = require('openvibe-shared/kit');

const HOST = 'openvibe.fun';
const REMIND = 'https://openvibe.today/remind';

/** The moment a plan starts, in UTC, or null when it has none. */
function startsAt(plan) {
    const raw = plan && plan.starts_at;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** The reminder's title: the plan's own name, the city it is in, and that it starts. */
function remindTitle(plan) {
    const name = String(plan && plan.title ? plan.title : '').trim();
    const city = String(plan && plan.city ? plan.city : '').trim();
    return city ? `${name} in ${city} starts` : `${name} starts`;
}

/** Today's "Remind me" link for this plan, or '' when there is nothing to remind about. */
function remindLink(plan, { now = Date.now(), url = '', action = false } = {}) {
    const at = startsAt(plan);
    if (!at || Date.parse(at) <= now) return '';
    const query = new URLSearchParams({ title: remindTitle(plan), at, url, from: HOST });
    const href = `${REMIND}?${query}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const cls = action ? 'fu-remind fu-btn fu-btn-quiet' : 'fu-remind';
    return `<a class="${cls}" href="${href}">${kit.icon('bell', { size: 16 })}<span>Remind me</span></a>`;
}

module.exports = { startsAt, remindTitle, remindLink, HOST, REMIND };
