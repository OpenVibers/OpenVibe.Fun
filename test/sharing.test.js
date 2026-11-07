'use strict';
/**
 * Sharing a plan and a quest (design 2026-11-06, visibility step 6): Fun's own visibility columns move onto
 * openvibe-sdk/share rows, 1:1, and the old column is kept in step so old readers fail closed.
 *
 *   - a plan's word at creation is its share row (unlisted -> Anyone with the link);
 *   - the Share sheet's audience writes the old column (people/private -> hidden);
 *   - a Specific-people plan answers the gate, never its title, to somebody not on the list;
 *   - accepting a quest makes it Everyone, on both the column and the share row;
 *   - gathered pages still list only the column's public rows.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const sharing = require('../server/sharing');
const { createStore } = require('../server/store');
const pages = require('../server/http/pages');
const views = require('../server/views');
const { createApp } = require('../server/app');

(async () => {
    const t = await boot();
    try {
        await check('the sharing wiring loads: the column mapping is 1:1', async () => {
            assert.strictEqual(sharing.SERVICE, 'fun');
            assert.deepStrictEqual(sharing.KINDS, ['quest', 'plan']);
            assert.deepStrictEqual(sharing.AUDIENCE_OF_COLUMN, { public: 'public', unlisted: 'link', hidden: 'private' });
            assert.deepStrictEqual(sharing.COLUMN_OF_AUDIENCE, { public: 'public', link: 'unlisted', people: 'hidden', private: 'hidden' });
            assert.strictEqual(sharing.shareViewer({ kind: 'anonymous' }), null);
            assert.strictEqual(typeof createStore, 'function');
            assert.strictEqual(typeof pages.createPageRoutes, 'function');
            assert.strictEqual(typeof createApp, 'function');
            assert.strictEqual(typeof views.quest, 'function');
            assert.strictEqual(typeof views.plan, 'function');
        });
        const kim = t.network.addUser('kim');
        const bo = t.network.addUser('bo');
        const future = new Date(Date.now() + 172_800_000).toISOString();
        const audienceRow = async (kind, slug) => await t.ctx.s.db.maybe(
            'SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3', ['fun', kind, slug]);
        const column = async (slug) => await t.ctx.s.db.value('SELECT visibility FROM fun_plans WHERE slug = $1', [slug]);
        const call = (p, o = {}) => {
            const { headers, ...rest } = o;
            return t.get(p, { ...rest, headers: { 'x-requested-with': 'ov-share', ...(headers || {}) } });
        };
        const share = (kind, slug, o = {}) => call(`/api/v1/${kind}/${encodeURIComponent(slug)}/share`, o);
        const setShare = async (kind, slug, body, as) => {
            const first = await share(kind, slug, { as });
            assert.strictEqual(first.status, 200, first.text);
            const etag = first.headers.get('etag');
            assert.ok(etag);
            return await share(kind, slug, { as, method: 'PUT', json: body, headers: { 'if-match': etag } });
        };

        let slug;
        await check('a plan starts at its own word (unlisted -> Anyone with the link), and its owner gets the Share button', async () => {
            const out = await t.ctx.store.createPlan({ ownerSubject: kim.subject, ownerUsername: 'kim', title: 'Beach day', startsAt: future, visibility: 'unlisted', options: [{ title: 'The pier' }] });
            assert.strictEqual(out.ok, true, out.message);
            slug = out.plan.slug;
            assert.deepStrictEqual(await audienceRow('plan', slug), { audience: 'link' });
            assert.strictEqual(await column(slug), 'unlisted');
            const guest = await t.get(`/plans/${slug}`);
            assert.strictEqual(guest.status, 200, guest.text);
            assert.ok(guest.text.includes('Beach day'));
            const mine = await t.get(`/plans/${slug}`, { as: kim });
            assert.strictEqual(mine.status, 200);
            assert.ok(mine.text.includes('data-ov-share-sheet') && mine.text.includes('data-kind="plan"'));
            assert.ok(mine.text.includes('ov-share.js'));
        });

        await check('the Share sheet writes the old column: Specific people becomes hidden and answers the gate', async () => {
            const saved = await setShare('plan', slug, { audience: 'people', members: [{ name: 'bo', role: 'viewer' }] }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            assert.strictEqual(await column(slug), 'hidden', 'an old reader sees Only me');
            const viewer = await t.get(`/plans/${slug}`, { as: bo });
            assert.strictEqual(viewer.status, 200, viewer.text);
            assert.ok(viewer.text.includes('Beach day'));
            const stranger = t.network.addUser('di');
            const gate = await t.get(`/plans/${slug}`, { as: stranger });
            assert.strictEqual(gate.status, 404);
            assert.ok(gate.text.includes('shared with specific people'));
            assert.ok(!gate.text.includes('Beach day'), 'the gate never shows the title');
            assert.ok(gate.text.includes('data-ov-share-gate'));
            assert.strictEqual((await t.get(`/api/v1/plans/${slug}`, { as: stranger })).status, 404);
        });

        await check('Everyone writes public back to the column and the gathered list', async () => {
            const saved = await setShare('plan', slug, { audience: 'public' }, kim);
            assert.strictEqual(saved.status, 200, saved.text);
            assert.strictEqual(await column(slug), 'public');
            const list = await t.get('/api/v1/plans');
            assert.strictEqual(list.status, 200);
            assert.ok(list.json().plans.some((p) => p.slug === slug), 'a public plan is listed');
            const sitemap = await t.get('/sitemap.xml');
            assert.ok(sitemap.text.includes(slug), 'a public plan is on the sitemap');
        });

        await check('a quest suggestion is a link; accepting it makes it Everyone on both the column and the share row', async () => {
            const board = await t.ctx.store.createBoard({ streamerSubject: kim.subject, title: 'Saturday quests', liveUsername: 'kim', chatUsername: 'kimchat' });
            assert.strictEqual(board.ok, true, board.message);
            const sug = await t.ctx.store.createSuggestion({ boardId: board.board.id, subject: bo.subject, title: 'Dance in the park', brief: 'A ten minute dance.', category: 'silly' });
            assert.strictEqual(sug.ok, true, sug.message);
            const qsl = sug.quest.slug;
            assert.deepStrictEqual(await audienceRow('quest', qsl), { audience: 'link' });
            assert.strictEqual(await t.ctx.s.db.value('SELECT visibility FROM fun_quests WHERE slug = $1', [qsl]), 'unlisted');
            const accepted = await t.ctx.store.acceptQuest({ slug: qsl, subject: kim.subject });
            assert.strictEqual(accepted.ok, true, accepted.message);
            assert.deepStrictEqual(await audienceRow('quest', qsl), { audience: 'public' });
            assert.strictEqual(await t.ctx.s.db.value('SELECT visibility FROM fun_quests WHERE slug = $1', [qsl]), 'public');
            const guest = await t.get(`/q/${qsl}`);
            assert.strictEqual(guest.status, 200, guest.text);
            assert.ok(guest.text.includes('Dance in the park'));
        });

        done();
    } finally {
        await t.close();
    }
})().catch((err) => { console.error(err); process.exit(1); });
