'use strict';
// Fun's home leads with what is real (owner, 10-31: empty sections made the rooms look unfinished). With no public
// quest or plan yet, the local guide leads and one short "Be the first" row sits below it; once there are some, they
// lead in their own sections and the row says only what is still missing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const views = require('../server/views');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/views/index.js'), 'utf8');
assert.match(src, /const live = `\$\{questsSec\}\$\{plansSec\}\$\{guide\}\$\{beFirst\}`;/, 'the order: quests, plans, the guide, then what is still missing');

const empty = views.home({ counts: {}, featured: [], plans: [] });
assert.ok(!empty.includes('id="fu-featured"') && !empty.includes('id="fu-plans"'), 'no empty sections');
assert.ok(empty.indexOf('id="fu-guide-teaser"') < empty.indexOf('Be the first'), 'the guide leads, the row follows');
assert.ok(empty.includes('href="/live">Open a board</a>') && empty.includes('href="/plans/new">Start a plan</a>'), 'each missing thing says how to start it');

const quest = { slug: 'bench', title: 'Find the best bench with a view', status: 'accepted', category: 'outdoors', votes: 12 };
const some = views.home({ counts: { quests: 1 }, featured: [quest], plans: [] });
assert.ok(some.indexOf('id="fu-featured"') < some.indexOf('id="fu-guide-teaser"'), 'quests lead once there are some');
assert.ok(some.includes('Be the first') && !some.includes('href="/live">Open a board</a>'), 'and the row keeps only what is still missing');
// The visitor's words (11-02): no operator sentence ("when a key is configured"), Ticketmaster only when it is on, and
// one "Find something near me" (the hero's; the guide teaser had a second one right under it).
assert.ok(!/configured/.test(empty), 'no operator wording on the home');
assert.ok(!empty.includes('Ticketmaster'), 'no Ticketmaster mention while it is off');
assert.ok(views.home({ events: true }).includes('local events from Ticketmaster'), 'named when it is on');
assert.ok(!empty.includes('OpenCoins') && empty.includes('the badge is awarded.'), 'no OpenCoins while they are off');
assert.ok(views.home({ coins: true }).includes('awarded with OpenCoins: loyalty points, never money.'), 'named when they are on');
assert.strictEqual(empty.split('Find something near me').length - 1, 1, 'one "Find something near me" on the home');
console.log('fun home: real first, the guide leads when nothing is public, one "be the first" row for the rest');
