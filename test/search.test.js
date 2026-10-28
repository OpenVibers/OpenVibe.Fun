'use strict';
/**
 * The Search Fabric feed: a public quest is owner fun / type quest / /q/<slug>; a public plan is type plan /
 * /plans/<slug>. Both validate against search.index-document@1, carry a revision, and hiding or cancelling one
 * queues a tombstone that wins. A suggestion or an unlisted plan has no document.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        const ada = t.network.addUser('ada');
        const kim = t.network.addUser('kim');
        const mod = t.network.addUser('mod', { role: 'global_mod' });
        const future = new Date(Date.now() + 172_800_000).toISOString();

        let quest = null;
        let plan = null;
        await check('a suggestion and an unlisted plan queue no Search document', async () => {
            const b = await t.get('/api/v1/quests/boards', { as: ada, json: { live_username: 'ada', title: 'Search board' } });
            const s = await t.get(`/api/v1/quests/boards/${b.json().id}/suggest`, { as: kim, json: { title: 'Find the best bench', brief: 'Walk ten minutes.' } });
            quest = s.json();
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_outbox')), 0);
            const p = await t.get('/api/v1/plans', { as: kim, json: { title: 'Unlisted plan', starts_at: future, timezone: 'UTC', options: [{ title: 'One' }] } });
            assert.strictEqual(p.status, 201);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_outbox')), 0);
            plan = p.json();
        });

        await check('accepting a quest writes a valid search.index-document@1 for /q/<slug>', async () => {
            const r = await t.get(`/api/v1/quests/${quest.slug}/accept`, { as: ada, json: {} });
            assert.strictEqual(r.status, 200, r.text);
            const row = await t.ctx.s.db.maybe("SELECT topic, payload FROM fun_outbox WHERE topic = 'fun.index_document.upserted' ORDER BY created_at DESC LIMIT 1");
            assert.ok(row);
            const v = contracts.validate('search.index-document@1', row.payload);
            assert.strictEqual(v.valid, true, JSON.stringify(v.errors));
            assert.strictEqual(row.payload.owner, 'fun');
            assert.strictEqual(row.payload.type, 'quest');
            assert.strictEqual(row.payload.id, quest.id);
            assert.strictEqual(row.payload.revision, 2);
            assert.strictEqual(row.payload.canonical_url, `https://openvibe.fun/q/${quest.slug}`);
            assert.strictEqual(row.payload.publication_state, 'published');
            assert.strictEqual(row.payload.indexability.decision, 'index');
            assert.strictEqual(row.payload.facets.category, 'near_me');
            assert.strictEqual(row.payload.provenance[0].service, 'live');
            assert.strictEqual(row.payload.provenance[0].id, 'ada');
            assert.ok(row.payload.body.includes('Find the best bench'));
        });

        await check('a public plan queues a valid plan document with its options and no voter data', async () => {
            const publicPlan = await t.get('/api/v1/plans', { as: kim, json: { title: 'Public plan', starts_at: future, timezone: 'UTC', visibility: 'public', options: [{ title: 'Mural walk', accessible: true }, { title: 'Bowling' }] } });
            assert.strictEqual(publicPlan.status, 201);
            const row = await t.ctx.s.db.maybe("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.upserted' AND payload->>'type' = 'plan' ORDER BY created_at DESC LIMIT 1");
            assert.ok(row);
            const v = contracts.validate('search.index-document@1', row.payload);
            assert.strictEqual(v.valid, true, JSON.stringify(v.errors));
            assert.strictEqual(row.payload.canonical_url, `https://openvibe.fun/plans/${publicPlan.json().slug}`);
            assert.strictEqual(row.payload.facets.accessible, true);
            assert.ok(row.payload.body.includes('Mural walk'));
            assert.ok(!row.payload.body.includes(kim.subject), 'no owner subject in a public document');
        });

        await check('a vote does not bump the revision; deciding does, and hiding writes a valid tombstone', async () => {
            const publicPlan = (await t.ctx.s.db.many("SELECT * FROM fun_plans WHERE slug = 'public-plan'"))[0];
            const options = await t.ctx.s.db.many('SELECT * FROM fun_plan_options WHERE plan_id = $1 ORDER BY position', [publicPlan.id]);
            await t.get(`/api/v1/plans/${publicPlan.slug}/vote`, { as: kim, json: { option_id: options[0].id } });
            await t.get(`/api/v1/plans/${publicPlan.slug}/vote`, { as: ada, json: { option_id: options[1].id } });
            await t.get(`/api/v1/plans/${publicPlan.slug}/vote`, { as: t.network.addUser('bo'), json: { option_id: options[0].id } });
            const before = await t.ctx.s.db.value("SELECT revision FROM fun_plans WHERE id = $1", [publicPlan.id]);
            const dec = await t.get(`/api/v1/plans/${publicPlan.slug}/decide`, { as: kim, json: {} });
            assert.strictEqual(dec.status, 200, dec.text);
            const after = await t.ctx.s.db.value('SELECT revision FROM fun_plans WHERE id = $1', [publicPlan.id]);
            assert.strictEqual(Number(after), Number(before) + 1);
            const ups = await t.ctx.s.db.many("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.upserted' AND payload->>'type' = 'plan' ORDER BY created_at");
            assert.strictEqual(Number(ups[ups.length - 1].payload.revision), Number(after));
            assert.strictEqual((await t.get(`/api/v1/plans/${publicPlan.slug}/hide`, { as: mod, method: 'POST' })).status, 200);
            const tomb = await t.ctx.s.db.maybe("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.deleted' AND payload->>'type' = 'plan' ORDER BY created_at DESC LIMIT 1");
            assert.strictEqual(contracts.validate('search.index-document@1', tomb.payload).valid, true);
            assert.strictEqual(tomb.payload.deleted, true);
            assert.strictEqual(tomb.payload.id, publicPlan.id);
        });
    } finally {
        await t.close();
    }
    done();
})();
