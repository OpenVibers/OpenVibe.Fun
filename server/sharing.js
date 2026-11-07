'use strict';

/**
 * Sharing on OpenVibe.Fun (design 2026-11-06, visibility step 6), through openvibe-sdk/share.
 *
 * Fun already had its own three words on fun_quests.visibility and fun_plans.visibility. This moves them onto share
 * rows, 1:1 (public -> Everyone, unlisted -> Anyone with the link, hidden -> Only me), and keeps the old column: it is
 * still written whenever the audience changes, so an old reader fails closed (Everyone/link stay public/unlisted,
 * Specific people and Only me are hidden). The read paths ask the share row first and fall back to the column for a
 * row made before the move.
 *
 * A quest's owner is the streamer whose board it is (or the person who suggested it); a plan's owner is its creator.
 * Status still rules a quest: only the streamer accepts it (and accepting makes it Everyone), and staff can hide it
 * (which makes it Only me). Those transitions write the share row too, so the sheet and the column never disagree.
 */
const { createShares } = require('openvibe-sdk/share');
const { serviceAuth } = require('openvibe-contracts');

const SERVICE = 'fun';
const KINDS = ['quest', 'plan'];
const AUDIENCES = ['public', 'link', 'people', 'private'];
/** The column's three words, and the audience each one means. */
const AUDIENCE_OF_COLUMN = { public: 'public', unlisted: 'link', hidden: 'private' };
const COLUMN_OF_AUDIENCE = { public: 'public', link: 'unlisted', people: 'hidden', private: 'hidden' };
const TABLE = { quest: 'fun_quests', plan: 'fun_plans' };

const refOf = (kind, id) => ({ service: SERVICE, kind: String(kind), id: String(id) });

/** Fun's viewer as the SDK wants it: a subject object. Staff are moderators, not readers of a private plan. */
function shareViewer(v) {
    if (!v || v.kind !== 'user' || !v.subject) return null;
    return { subject: { type: 'user', id: String(v.subject) }, staff: false };
}

function createSharing({ db, config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String(config.networkInternalUrl || '').replace(/\/+$/, '');
    const tokens = config.oauth && config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: base + '/oauth/token',
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.network',
        scope: 'identity.subject.resolve network.notifications.push',
        fetch: fetchImpl,
    }) : null;

    async function networkJson({ path, method = 'GET', json, query } = {}) {
        if (!tokens) throw new Error('Network is not configured for this service');
        const url = new URL(base + path);
        for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (json !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(8000) });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error('Network ' + method + ' ' + path + ' ' + res.status + ': ' + ((body && (body.detail || body.error)) || 'failed'));
            err.status = res.status;
            throw err;
        }
        return body;
    }

    /** One notification. It never carries the quest's or plan's title. */
    async function notify(n) {
        const to = n && n.to;
        if (!to || to.type !== 'user') return;
        const words = {
            'share.added': ['Something was shared with you on OpenVibe.Fun', 'Open OpenVibe.Fun to read it.'],
            'share.access_requested': ['Someone asked for access on OpenVibe.Fun', 'Review the request on OpenVibe.Fun.'],
            'share.transfer.requested': ['Someone wants to give you something on OpenVibe.Fun', 'Accept or decline it on OpenVibe.Fun.'],
            'share.transfer.answered': ['A transfer on OpenVibe.Fun was answered', 'See what happened on OpenVibe.Fun.'],
        }[n.kind] || ['Sharing on OpenVibe.Fun', 'There is something new for you.'];
        const kind = n.ref && n.ref.kind === 'plan' ? 'plans' : 'q';
        try {
            await networkJson({
                path: '/internal/notifications/push', method: 'POST',
                json: {
                    subject: to.id, type: 'GENERIC', title: words[0], message: words[1],
                    service: 'fun', url: n.ref && n.ref.id ? `${config.baseUrl}/${kind}/${encodeURIComponent(n.ref.id)}` : `${config.baseUrl}/`,
                    category: 'social',
                },
            });
        } catch (err) {
            log.warn('[Sharing] notification not sent:', err.message);
        }
    }

    async function publish(envelope) {
        if (!config.events || !config.events.url) { log.warn('[Sharing] no events URL configured; share envelope not sent'); return; }
        const res = await fetchImpl(String(config.events.url).replace(/\/+$/, ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error('Events answered ' + res.status);
    }

    /** The share change writes the old column, in the same transaction, so an old reader sees the narrower word. */
    async function onAudienceChange(ref, audience, tx) {
        const table = TABLE[ref.kind];
        if (!table) return;
        await tx.exec(`UPDATE ${table} SET visibility = $1, updated_at = now() WHERE slug = $2`,
            [COLUMN_OF_AUDIENCE[audience] || 'hidden', String(ref.id)]);
    }

    const shares = createShares({
        db,
        network: { json: networkJson },
        events: { publish },
        notify,
        onAudienceChange,
    });

    /** The audience the share row holds, or null for a row made before the move (the column decides then). */
    const audienceOf = async (kind, slug) => {
        const row = await db.maybe('SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3',
            [SERVICE, String(kind), String(slug)]);
        return row ? row.audience : null;
    };

    return {
        shares,
        SERVICE,
        KINDS,
        AUDIENCES,
        AUDIENCE_OF_COLUMN,
        COLUMN_OF_AUDIENCE,
        refOf,
        shareViewer,
        networkJson,
        canView: async (viewer, kind, slug) => await shares.canView(shareViewer(viewer), refOf(kind, slug)),
        canEdit: async (viewer, kind, slug) => await shares.canEdit(shareViewer(viewer), refOf(kind, slug)),
        audienceOf,
        /** A new quest or plan: its column's word becomes its share row, at the same moment and in the same transaction. */
        registerSystem: async (kind, slug, ownerSubject, column, tx = db) => {
            if (!TABLE[kind] || !ownerSubject || !/^usr_[0-9A-HJKMNP-TV-Z]{26}$/.test(String(ownerSubject))) return;
            await tx.exec(`INSERT INTO shares (service, kind, resource_id, owner_subject, audience)
                VALUES ($1, $2, $3, $4, $5) ON CONFLICT (service, kind, resource_id) DO NOTHING`,
                [SERVICE, String(kind), String(slug), { type: 'user', id: String(ownerSubject) }, AUDIENCE_OF_COLUMN[column] || 'private']);
        },
        /** A status change that moves the audience (accept -> Everyone, hide -> Only me). Never widens silently. */
        setSystemAudience: async (kind, slug, column, tx = db) => {
            if (!TABLE[kind]) return;
            await tx.exec('UPDATE shares SET audience = $1, revision = revision + 1 WHERE service = $2 AND kind = $3 AND resource_id = $4',
                [AUDIENCE_OF_COLUMN[column] || 'private', SERVICE, String(kind), String(slug)]);
        },
        /** The uniform API's describe(ref): the quest's or plan's title and page. */
        describe: async (ref) => {
            if (ref.service !== SERVICE) return {};
            if (ref.kind === 'quest') {
                const row = await db.maybe('SELECT slug, title FROM fun_quests WHERE slug = $1', [String(ref.id)]);
                if (!row) return {};
                return { title: String(row.title || 'A quest').slice(0, 120), link: `${config.baseUrl}/q/${encodeURIComponent(row.slug)}`, roles: ['viewer'], transferable: false };
            }
            if (ref.kind === 'plan') {
                const row = await db.maybe('SELECT slug, title FROM fun_plans WHERE slug = $1', [String(ref.id)]);
                if (!row) return {};
                return { title: String(row.title || 'A plan').slice(0, 120), link: `${config.baseUrl}/plans/${encodeURIComponent(row.slug)}`, roles: ['viewer'], transferable: false };
            }
            return {};
        },
        /** Expire members and transfers, then send the queued events and notifications. */
        work: async ({ flush = true } = {}) => {
            let expired = 0;
            try { expired = await shares.expireMembers(); } catch (err) { log.warn('[Sharing] expiry sweep:', err.message); }
            let sent = 0;
            if (flush) { try { sent = await shares.flush(); } catch (err) { log.warn('[Sharing] deliveries:', err.message); } }
            return { expired, sent };
        },
    };
}

module.exports = { createSharing, shareViewer, refOf, KINDS, AUDIENCES, AUDIENCE_OF_COLUMN, COLUMN_OF_AUDIENCE, SERVICE };
