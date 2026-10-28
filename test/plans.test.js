'use strict';
/**
 * Group plans: options, one vote per person, a tie refused, the owner decides, the winner goes to the viewer's own
 * Today through Today's public API with the viewer's token and an idempotency key. No service token, no posting to
 * anyone else's calendar. Public plans are listed; a hidden one is 404.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        const kim = t.network.addUser('kim');
        const ada = t.network.addUser('ada');
        const bo = t.network.addUser('bo');
        const mod = t.network.addUser('mod', { role: 'global_mod' });
        const future = new Date(Date.now() + 172_800_000).toISOString();
        let plan = null;

        await check('a signed-in person starts a public plan with options; unlisted stays out of the list', async () => {
            const r = await t.get('/api/v1/plans', { as: kim, json: { title: 'Friday with the group', summary: 'Two choices.', city: 'Portland', starts_at: future, timezone: 'UTC', visibility: 'public', options: [{ title: 'Mural walk', accessible: true }, { title: 'Bowling' }] } });
            assert.strictEqual(r.status, 201, r.text);
            plan = r.json();
            assert.strictEqual(plan.status, 'voting');
            assert.strictEqual(plan.options.length, 2);
            assert.strictEqual(plan.visibility, 'public');
            const list = await t.get('/api/v1/plans');
            assert.ok(list.json().plans.some((p) => p.slug === plan.slug));
            const unlisted = await t.get('/api/v1/plans', { as: kim, json: { title: 'A private share link', starts_at: future, timezone: 'UTC', options: [{ title: 'Option' }] } });
            assert.strictEqual(unlisted.status, 201);
            assert.ok(!(await t.get('/api/v1/plans')).json().plans.some((p) => p.slug === unlisted.json().slug));
            assert.strictEqual((await t.get(`/api/v1/plans/${unlisted.json().slug}`)).status, 200);
        });

        await check('one vote per person, a second vote changes it, and a tie is refused', async () => {
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: kim, json: { option_id: plan.options[0].id } })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: kim, json: { option_id: plan.options[1].id } })).status, 200);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int FROM fun_plan_votes WHERE plan_id = $1', [plan.id])), 1);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: ada, json: { option_id: plan.options[0].id } })).status, 200);
            const tie = await t.get(`/api/v1/plans/${plan.slug}/decide`, { as: kim, json: {} });
            assert.strictEqual(tie.status, 409);
            assert.strictEqual(tie.json().code, 'fun.plan_tie');
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: bo, json: { position: 2 } })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/decide`, { as: ada, json: {} })).status, 403);
            const decided = await t.get(`/api/v1/plans/${plan.slug}/decide`, { as: kim, json: {} });
            assert.strictEqual(decided.status, 200, decided.text);
            assert.strictEqual(decided.json().status, 'decided');
            assert.strictEqual(decided.json().winner_option_id, plan.options[1].id);
        });

        await check('the winner is added to the viewer\'s own Today with their token and an idempotency key', async () => {
            const r = await t.get(`/api/v1/plans/${plan.slug}/today`, { as: kim, json: {} });
            assert.strictEqual(r.status, 201, r.text);
            assert.match(r.json().url, /^https:\/\/openvibe\.today\/e\/evt_test_/);
            assert.strictEqual(t.upstreams.state.todayEvents.length, 1);
            const call = t.upstreams.state.todayEvents[0];
            assert.match(call.auth, /^Bearer /);
            assert.strictEqual(call.idempotency_key, `fun-plan-${plan.id}`);
            assert.strictEqual(call.body.kind, 'event');
            assert.strictEqual(call.body.title, 'Fun: Friday with the group');
            assert.match(call.body.description, /Bowling/);
            assert.strictEqual(call.body.visibility, 'public');
            assert.strictEqual(call.body.tz, 'UTC');
            assert.ok(call.body.starts_at.startsWith(future.slice(0, 16)));
        });

        await check('an undecided plan, a cross-site write and a not-signed-in call are refused before Today', async () => {
            const future2 = new Date(Date.now() + 190_000_000).toISOString();
            const p = await t.get('/api/v1/plans', { as: kim, json: { title: 'Not decided yet', starts_at: future2, timezone: 'UTC', options: [{ title: 'One' }] } });
            assert.strictEqual(p.status, 201);
            const early = await t.get(`/api/v1/plans/${p.json().slug}/today`, { as: kim, json: {} });
            assert.strictEqual(early.status, 409);
            assert.strictEqual(early.json().code, 'fun.plan_not_decided');
            const cross = await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: kim, json: { option_id: plan.options[0].id }, origin: 'https://evil.example' });
            assert.strictEqual(cross.status, 403);
            assert.strictEqual(cross.json().code, 'fun.cross_site');
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/today`, { json: {} })).status, 401);
            assert.strictEqual(t.upstreams.state.todayEvents.length, 1);
        });

        await check('the plan page has the options, vote forms, the winner and the Today form', async () => {
            const r = await t.get(`/plans/${plan.slug}`, { as: kim });
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('id="fu-plan"'));
            assert.ok(r.text.includes('id="fu-plan-options"'));
            assert.ok(r.text.includes('id="fu-plan-actions"'));
            assert.ok(r.text.includes('Mural walk'));
            assert.ok(r.text.includes('Bowling'));
            assert.ok(r.text.includes('Add the winner to my Today'));
            assert.strictEqual(r.headers.get('cache-control'), 'private, no-store');
            const pub = await t.get(`/plans/${plan.slug}`);
            assert.strictEqual(pub.headers.get('cache-control'), 'public, max-age=60');
        });

        await check('staff can hide; a report is stored; the plan page and document are gone', async () => {
            const rep = await t.get(`/api/v1/plans/${plan.slug}/report`, { as: bo, json: { kind: 'spam', reason: 'This is a duplicate plan' } });
            assert.strictEqual(rep.status, 201, rep.text);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/hide`, { as: kim, method: 'POST' })).status, 403);
            const hide = await t.get(`/api/v1/plans/${plan.slug}/hide`, { as: mod, method: 'POST' });
            assert.strictEqual(hide.status, 200);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}`)).status, 404);
            assert.ok(!(await t.get('/api/v1/plans')).json().plans.some((p) => p.slug === plan.slug));
            const tomb = await t.ctx.s.db.maybe("SELECT payload FROM fun_outbox WHERE topic = 'fun.index_document.deleted' ORDER BY created_at DESC LIMIT 1");
            assert.strictEqual(tomb.payload.deleted, true);
            assert.strictEqual(tomb.payload.type, 'plan');
        });
    } finally {
        await t.close();
    }
    done();
})();
