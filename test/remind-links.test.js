'use strict';
/**
 * "Remind me" on a plan's start (plan L48 R3): the link to openvibe.today/remind on the plan's own page and on the
 * cards that show the start, with the right title, time and page — and no link at all once the start has passed.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

/** Every "Remind me" link on a page, as the URL it points at. */
function remindLinks(html) {
    return [...String(html).matchAll(/href="(https:\/\/openvibe\.today\/remind\?[^"]+)"/g)]
        .map((m) => m[1].replace(/&amp;/g, '&'));
}
const query = (href) => Object.fromEntries(new URL(href.replace(/&amp;/g, '&')).searchParams);

(async () => {
    const t = await boot();
    try {
        const kim = t.network.addUser('kim');
        const future = new Date(Date.now() + 172_800_000).toISOString();

        await check('a plan that starts later links to Today\'s "Remind me" on its page and on the cards', async () => {
            const r = await t.get('/api/v1/plans', { as: kim, json: { title: 'Friday with the group', summary: 'Two choices.', city: 'Portland', starts_at: future, timezone: 'UTC', visibility: 'public', options: [{ title: 'Mural walk' }, { title: 'Bowling' }] } });
            assert.strictEqual(r.status, 201, r.text);
            const slug = r.json().slug;

            const page = await t.get(`/plans/${slug}`);
            const links = remindLinks(page.text);
            assert.ok(links.length, 'the plan\'s own page has a "Remind me" link');
            const q = query(links[0]);
            assert.strictEqual(q.title, 'Friday with the group in Portland starts');
            assert.strictEqual(q.at, new Date(future).toISOString(), 'the start itself, in UTC');
            assert.strictEqual(q.url, `https://openvibe.fun/plans/${slug}`, 'the plan\'s canonical page');
            assert.strictEqual(q.from, 'openvibe.fun');

            const list = await t.get('/plans');
            const cardLink = remindLinks(list.text).find((h) => query(h).url === `https://openvibe.fun/plans/${slug}`);
            assert.ok(cardLink, 'the plan card has the link too');

            const home = await t.get('/');
            const homeLink = remindLinks(home.text).find((h) => query(h).url === `https://openvibe.fun/plans/${slug}`);
            assert.ok(homeLink, 'the front page\'s card has the link too');
            assert.strictEqual(query(homeLink).at, new Date(future).toISOString());
        });

        await check('a plan that has started has no "Remind me" link', async () => {
            const r = await t.get('/api/v1/plans', { as: kim, json: { title: 'Yesterday with the group', starts_at: future, timezone: 'UTC', visibility: 'public', options: [{ title: 'Option' }] } });
            assert.strictEqual(r.status, 201, r.text);
            const slug = r.json().slug;
            // The start moves into the past: nobody may be reminded for a plan that has begun.
            const past = new Date(Date.now() - 3600_000).toISOString();
            await t.ctx.s.db.maybe('UPDATE fun_plans SET starts_at = $1, closes_at = $2 WHERE slug = $3', [past, past, slug]);
            const page = await t.get(`/plans/${slug}`);
            assert.strictEqual(remindLinks(page.text).length, 0, 'no link once the start has passed');
        });
    } finally {
        await t.close();
    }
    done();
})();
