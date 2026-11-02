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
console.log('fun home: real first, the guide leads when nothing is public, one "be the first" row for the rest');
