'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        const kim = t.network.addUser('kim');
        const ada = t.network.addUser('ada');
        const place = 'https://openvibe.tours/place/kubota-garden-plc_0123456789ABCDEFGHJKMNPQRS';
        await check('Tours place fills the plan form and signed-out redirect keeps context', async () => {
            const url = `/plans/new?${new URLSearchParams({ place: 'Kubota Garden', city: 'Seattle', url: place })}`;
            const signedOut = await t.get(url);
            assert.strictEqual(signedOut.status, 401);
            assert.match(signedOut.text, /Kubota/);
            const form = await t.get(url, { as: kim });
            assert.match(form.text, /Go to Kubota Garden together/);
            assert.match(form.text, /Option 1 date and time/);
            assert.match(form.text, /See the place/);
        });
        await check('a voted date becomes the plan date', async () => {
            const first = new Date(Date.now() + 3 * 86_400_000).toISOString();
            const second = new Date(Date.now() + 4 * 86_400_000).toISOString();
            const created = await t.get('/api/v1/plans', { as: kim, json: {
                title: 'Go to Kubota Garden together', city: 'Seattle', starts_at: first, timezone: 'UTC',
                options: [{ title: 'Saturday', place_name: 'Kubota Garden', starts_at: first }, { title: 'Sunday', place_name: 'Kubota Garden', starts_at: second }],
            } });
            assert.strictEqual(created.status, 201, created.text);
            const plan = created.json();
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/vote`, { as: ada, json: { option_id: plan.options[1].id } })).status, 200);
            assert.strictEqual((await t.get(`/api/v1/plans/${plan.slug}/decide`, { as: kim, json: {} })).status, 200);
            const decided = (await t.get(`/api/v1/plans/${plan.slug}`, { as: kim })).json();
            assert.strictEqual(decided.plan.starts_at, second);
        });
        let listPath;
        await check('two people can share a sourced list and add a place', async () => {
            const created = await t.get('/places', { as: kim, form: { title: 'Our places', place_name: 'Kubota Garden', place_url: place } });
            assert.strictEqual(created.status, 303, created.text);
            listPath = created.headers.get('location');
            assert.match(listPath, /^\/places\/lst_/);
            assert.match((await t.get(listPath)).text, /Kubota Garden/);
            const joined = await t.get(`${listPath}/join`, { as: ada, form: {} , method: 'POST' });
            assert.strictEqual(joined.status, 303);
            const after = await t.get(listPath, { as: ada });
            assert.match(after.text, /2 people/);
            const added = await t.get(`${listPath}/items`, { as: ada, form: { place_name: 'Another place', place_url: 'https://openvibe.tours/place/another-place-plc_0123456789ABCDEFGHJKMNPQRT' } });
            assert.strictEqual(added.status, 303);
            assert.match((await t.get(listPath)).text, /Another place/);
        });
        await check('a nonmember, another origin and an unrelated URL cannot add a place', async () => {
            const bo = t.network.addUser('bo');
            assert.strictEqual((await t.get(`${listPath}/items`, { as: bo, form: { place_name: 'No', place_url: place } })).status, 403);
            assert.strictEqual((await t.get(`${listPath}/items`, { as: ada, origin: 'https://elsewhere.example', form: { place_name: 'No', place_url: place } })).status, 403);
            assert.strictEqual((await t.get(`${listPath}/items`, { as: ada, form: { place_name: 'No', place_url: 'https://elsewhere.example/' } })).status, 400);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { process.stdout.write(String(err.stack || err)); process.exit(1); });
