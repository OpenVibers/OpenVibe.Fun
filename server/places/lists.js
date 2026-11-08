'use strict';

const express = require('express');
const { asyncRouter } = require('../http/router');
const { sameOrigin } = require('../http/principal');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');

const validPlace = (url) => /^https:\/\/openvibe\.tours\/place\/[a-z0-9-]+-plc_[0-9A-HJKMNP-TV-Z]{26}$/.test(String(url || ''));

function createPlaceListRoutes({ config, s }) {
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '16kb' }));
    const person = (req) => req.viewer?.kind === 'user' ? req.viewer.subject : null;
    const page = (req, res, title, body, status = 200) => send(res, status, {
        viewer: req.viewer, config, path: req.originalUrl, index: false, cache: null, title, body: raw(body),
    });
    const signIn = (req, res) => page(req, res, 'Our places', `<div class="fu-wrap fu-page-pad fu-narrow"><h1>Our places</h1><p>Sign in to make or join a shared list.</p><a class="fu-btn" href="/auth/login?next=${encodeURIComponent(req.originalUrl)}">Sign in</a></div>`, 401);
    const guarded = (req, res, next) => {
        if (!person(req)) return signIn(req, res);
        if (!sameOrigin(req, config.baseUrl)) return page(req, res, 'Not from this site', '<div class="fu-wrap"><h1>Use the form on OpenVibe.Fun</h1></div>', 403);
        next();
    };

    r.get('/places/new', (req, res) => {
        if (!person(req)) return signIn(req, res);
        const name = String(req.query.place || '').slice(0, 200);
        const url = validPlace(req.query.url) ? String(req.query.url) : '';
        return page(req, res, 'Our places', `<div class="fu-wrap fu-narrow" id="fu-places-new"><header class="fu-page-h"><p class="fu-kicker">Together</p><h1>Our places</h1><p class="fu-lede">Keep a list with the people you want to go with. Send its private link; each person joins with their OpenVibe account.</p></header>
<form class="fu-form fu-card" method="post" action="/places"><label class="fu-field"><span>List name</span><input name="title" maxlength="120" required value="Our places"></label>
${url ? `<input type="hidden" name="place_url" value="${esc(url)}"><input type="hidden" name="place_name" value="${esc(name)}"><p>Start with <a href="${esc(url)}" rel="noopener">${esc(name)}</a></p>` : ''}
<button class="fu-btn" type="submit">Create our list</button></form></div>`);
    });

    r.post('/places', guarded, async (req, res) => {
        const title = String(req.body.title || '').trim().slice(0, 120);
        if (title.length < 3) return page(req, res, 'Our places', '<div class="fu-wrap"><h1>Give your list a name</h1></div>', 400);
        const id = s.newId('lst');
        const subject = person(req);
        await s.tx(async (t) => {
            await t.exec('INSERT INTO fun_place_lists(id, owner_subject, title) VALUES ($1,$2,$3)', [id, subject, title]);
            await t.exec('INSERT INTO fun_place_list_members(list_id, subject) VALUES ($1,$2)', [id, subject]);
            if (validPlace(req.body.place_url) && String(req.body.place_name || '').trim()) {
                await t.exec('INSERT INTO fun_place_list_items(id, list_id, place_name, place_url, added_by) VALUES ($1,$2,$3,$4,$5)',
                    [s.newId('lpi'), id, String(req.body.place_name).trim().slice(0, 200), req.body.place_url, subject]);
            }
        });
        return res.redirect(303, `/places/${id}`);
    });

    r.get('/places/:id', async (req, res) => {
        const id = String(req.params.id || '');
        const list = await s.db.maybe('SELECT id, title FROM fun_place_lists WHERE id=$1', [id]);
        if (!list) return page(req, res, 'List not found', '<div class="fu-wrap"><h1>List not found</h1></div>', 404);
        const items = await s.db.many('SELECT place_name, place_url FROM fun_place_list_items WHERE list_id=$1 ORDER BY created_at, id', [id]);
        const members = await s.db.value('SELECT COUNT(*)::int FROM fun_place_list_members WHERE list_id=$1', [id]);
        const joined = person(req) && await s.db.maybe('SELECT 1 FROM fun_place_list_members WHERE list_id=$1 AND subject=$2', [id, person(req)]);
        return page(req, res, list.title, `<div class="fu-wrap fu-narrow" id="fu-places-list"><header class="fu-page-h"><p class="fu-kicker">Together · ${Number(members)} ${Number(members) === 1 ? 'person' : 'people'}</p><h1>${esc(list.title)}</h1><p class="fu-lede">Share this page with the people you want to go with. Signed-in members can add places.</p></header>
${items.length ? `<ol class="fu-places">${items.map((item) => `<li><a href="${esc(item.place_url)}" rel="noopener">${esc(item.place_name)}</a></li>`).join('')}</ol>` : '<p>No place saved yet.</p>'}
${joined ? `<form class="fu-form fu-card" method="post" action="/places/${esc(id)}/items"><label class="fu-field"><span>Place name</span><input name="place_name" maxlength="200" required></label><label class="fu-field"><span>OpenVibe.Tours place link</span><input name="place_url" type="url" required placeholder="https://openvibe.tours/place/..."></label><button class="fu-btn" type="submit">Add place</button></form>` : person(req) ? `<form method="post" action="/places/${esc(id)}/join"><button class="fu-btn" type="submit">Join this list</button></form>` : `<a class="fu-btn" href="/auth/login?next=${encodeURIComponent(req.originalUrl)}">Sign in to join</a>`}
<p><a href="https://openvibe.tours/cities">Find more places</a></p></div>`);
    });

    r.post('/places/:id/join', guarded, async (req, res) => {
        const id = String(req.params.id || '');
        const list = await s.db.maybe('SELECT id FROM fun_place_lists WHERE id=$1', [id]);
        if (!list) return page(req, res, 'List not found', '<div class="fu-wrap"><h1>List not found</h1></div>', 404);
        await s.db.exec('INSERT INTO fun_place_list_members(list_id, subject) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, person(req)]);
        return res.redirect(303, `/places/${id}`);
    });

    r.post('/places/:id/items', guarded, async (req, res) => {
        const id = String(req.params.id || '');
        const member = await s.db.maybe('SELECT 1 FROM fun_place_list_members WHERE list_id=$1 AND subject=$2', [id, person(req)]);
        if (!member) return page(req, res, 'Join first', '<div class="fu-wrap"><h1>Join this list first</h1></div>', 403);
        const name = String(req.body.place_name || '').trim().slice(0, 200);
        const url = String(req.body.place_url || '');
        if (!name || !validPlace(url)) return page(req, res, 'Choose a Tours place', '<div class="fu-wrap"><h1>Use an OpenVibe.Tours place link</h1></div>', 400);
        await s.db.exec(`INSERT INTO fun_place_list_items(id, list_id, place_name, place_url, added_by)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT(list_id, place_url) DO NOTHING`, [s.newId('lpi'), id, name, url, person(req)]);
        return res.redirect(303, `/places/${id}`);
    });
    return r;
}

module.exports = { createPlaceListRoutes, validPlace };
