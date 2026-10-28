'use strict';

/**
 * OpenVibe.Fun's Search Fabric feed. A public IRL quest is one `search.index-document@1` (owner `fun`, type `quest`,
 * page `/q/<slug>`); a public group plan is another (type `plan`, page `/plans/<slug>`). They are queued in
 * `fun_outbox` in the same transaction as the change; hiding or cancelling one queues a tombstone, which wins over
 * any older revision. The relay is deliberately not part of v1: rows wait until OpenVibe.Search's document writer
 * is configured for `fun` (it needs the search.document.write grant).
 *
 * A quest/plan body is the public text the person wrote plus the public facts around it. No voter, subject, chat
 * author or token is ever part of a document.
 */
const { ids } = require('openvibe-contracts');
const { cleanSummary } = require('./text/no-looks');

const OWNER = 'fun';
const EVENT_UPSERTED = 'fun.index_document.upserted';
const EVENT_DELETED = 'fun.index_document.deleted';
const QUEST_STATUSES = new Set(['accepted', 'live', 'completed', 'verified']);

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const baseOf = (config) => String(config.baseUrl).replace(/\/+$/, '');

function questDocument(q, { baseUrl = 'https://openvibe.fun' } = {}) {
    const revision = Math.max(1, Number(q.revision) || 1);
    if (!q || q.visibility !== 'public' || !QUEST_STATUSES.has(q.status)) return { owner: OWNER, type: 'quest', id: q.id, revision, deleted: true };
    // The curated idea deck is the one place Fun writes public text for a quest; a look-naming summary would
    // become the title. A person's own suggestion is never rewritten here.
    const summary = q.source === 'idea' ? cleanSummary(q.title, q.brief) : q.brief;
    const body = [
        q.title,
        q.brief,
        q.place_name ? `Place: ${q.place_name}` : '',
        q.city ? `City: ${q.city}` : '',
        q.accessible ? 'Accessible activity' : '',
        q.streamer_username ? `On OpenVibe.Live: @${q.streamer_username}` : '',
        q.status === 'verified' && q.reward_badge ? `Badge: ${q.reward_badge}` : '',
    ].filter(Boolean).join('\n').slice(0, 48_000);
    return {
        owner: OWNER,
        type: 'quest',
        id: q.id,
        revision,
        deleted: false,
        visibility: 'public',
        canonical_url: `${baseUrl}/q/${q.slug}`,
        title: q.title,
        ...(summary ? { summary: summary.slice(0, 4000) } : {}),
        body,
        facets: {
            status: q.status,
            category: q.category,
            ...(q.city ? { city: q.city } : {}),
            accessible: Boolean(q.accessible),
            streamer: q.streamer_username,
            source: q.source,
        },
        authorship: 'human',
        provenance: q.streamer_username ? [{
            service: 'live',
            type: 'channel',
            id: String(q.streamer_username).slice(0, 128),
            label: `OpenVibe.Live @${q.streamer_username}`,
            url: q.stream_url,
            ...(q.updated_at ? { retrieved_at: iso(q.updated_at) } : {}),
        }] : [],
        publication_state: 'published',
        published_at: iso(q.created_at),
        updated_at: iso(q.updated_at),
        indexability: { decision: 'index' },
    };
}

function planDocument(p, options = [], { baseUrl = 'https://openvibe.fun' } = {}) {
    const revision = Math.max(1, Number(p.revision) || 1);
    if (!p || p.visibility !== 'public' || p.status === 'cancelled') return { owner: OWNER, type: 'plan', id: p.id, revision, deleted: true };
    const winner = (options || []).find((o) => o.id === p.winner_option_id) || null;
    const body = [
        p.title,
        p.summary || '',
        p.city ? `City: ${p.city}` : '',
        ...(options || []).map((o) => `${o.position}. ${o.title}${o.accessible ? ' (accessible)' : ''}${o.details ? ` — ${o.details}` : ''}`),
        winner ? `Chosen: ${winner.title}` : '',
    ].filter(Boolean).join('\n').slice(0, 48_000);
    return {
        owner: OWNER,
        type: 'plan',
        id: p.id,
        revision,
        deleted: false,
        visibility: 'public',
        canonical_url: `${baseUrl}/plans/${p.slug}`,
        title: p.title,
        ...(p.summary ? { summary: p.summary.slice(0, 4000) } : {}),
        body,
        facets: {
            status: p.status,
            ...(p.city ? { city: p.city } : {}),
            accessible: (options || []).some((o) => o.accessible),
            options: (options || []).length,
        },
        authorship: 'human',
        provenance: [],
        publication_state: 'published',
        published_at: iso(p.created_at),
        updated_at: iso(p.updated_at),
        indexability: { decision: 'index' },
    };
}

function createSearchIndex({ config, s, baseUrl = config.baseUrl }) {
    const nowIso = () => new Date(s.now()).toISOString();
    const base = String(baseUrl).replace(/\/+$/, '');

    async function enqueue(topic, payload, t = null) {
        const db = t || s.db;
        const eventId = ids.newId('event', s.now());
        await db.exec(
            `INSERT INTO fun_outbox (event_id, topic, payload, created_at, next_attempt_at)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)`,
            [eventId, topic, JSON.stringify(payload), nowIso()],
        );
        return eventId;
    }

    async function sync(t, type, record, options = []) {
        const doc = type === 'quest' ? questDocument(record, { baseUrl: base }) : planDocument(record, options, { baseUrl: base });
        return await enqueue(doc.deleted ? EVENT_DELETED : EVENT_UPSERTED, doc, t);
    }

    async function remove(t, type, id, revision) {
        return await enqueue(EVENT_DELETED, { owner: OWNER, type, id, revision: Math.max(1, Number(revision) || 1), deleted: true }, t);
    }

    async function pending() {
        return Number(await s.db.value('SELECT COUNT(*)::int AS n FROM fun_outbox WHERE published_at IS NULL'));
    }

    return { sync, remove, enqueue, pending, baseUrl: base, questDocument, planDocument };
}

module.exports = {
    createSearchIndex, questDocument, planDocument, OWNER, EVENT_UPSERTED, EVENT_DELETED, QUEST_STATUSES,
};
