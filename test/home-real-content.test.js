'use strict';
// The home's scenes show what is real: the first public quest and plan, with their own votes, streamer and time.
// With nothing public they say so and offer the way to start it; no written-in person, vote or plan time.
const assert = require('assert');
const views = require('../server/views');

const quest = { slug: 'bench', title: 'Find the best bench with a view', status: 'accepted', category: 'outside', votes: 12, streamer_username: 'streamer_one' };
const plan = { slug: 'walk', title: 'Sunday walk in the park', status: 'decided', starts_at: '2026-11-08T19:00:00Z', city: 'Seattle' };
const some = views.home({ counts: { quests: 1, plans: 1 }, featured: [quest], plans: [plan] });
assert.ok(some.includes('Find the best bench with a view') && some.includes('12 votes') && some.includes('@streamer_one on Live'), 'the real quest, its votes and its streamer');
assert.ok(some.includes('href="/q/bench"'), 'the board links the quest');
assert.ok(some.includes('Sunday walk in the park') && some.includes('href="/plans/walk"'), 'the real plan and its link');
assert.ok(!some.includes('night owls') && !/Find the best bench with a view<\/b><small>12 votes · @ada on Live/.test(some), 'no written-in cast');

const empty = views.home({ counts: {}, featured: [], plans: [] });
assert.ok(empty.includes('No public quest yet') && empty.includes('href="/live">Open a board</a>'), 'an honest empty board');
assert.ok(empty.includes('No plan yet') && empty.includes('href="/plans/new">Start a plan</a>'), 'an honest empty plan');
for (const fake of ['@ada', '12 votes', 'Saturday, 19:00', 'Find the best bench with a view', 'Get a stranger to beatbox']) {
    assert.ok(!empty.includes(fake), `no written-in ${fake}`);
}
assert.ok(!some.includes('@ada on Live') && !some.includes('Get a stranger to beatbox'), 'no written-in cast beside the real one');
console.log('fun home: the board and plan scenes show the first real quest and plan, or say there is none');
