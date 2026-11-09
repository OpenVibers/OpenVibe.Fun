'use strict';
// A plan's time comes from a date picker now, and a date picker sends local time with no zone. Read as UTC, a 7:30 pm
// plan in Portland was saved for 11:30 am there (11-09). The time is read in the plan's time zone, which the form fills
// from the visitor's device; a value that carries its own zone keeps it.
//   node test/plan-times.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseWhen } = require('../server/store');

// Portland in November is UTC-8; in July, UTC-7 (daylight saving).
assert.strictEqual(parseWhen('2026-11-14T19:30', 'America/Los_Angeles').toISOString(), '2026-11-15T03:30:00.000Z');
assert.strictEqual(parseWhen('2026-07-14T19:30', 'America/Los_Angeles').toISOString(), '2026-07-15T02:30:00.000Z');
assert.strictEqual(parseWhen('2026-11-14T19:30:00', 'Asia/Tokyo').toISOString(), '2026-11-14T10:30:00.000Z');
// A value with its own zone keeps it; no zone and no time zone reads as before; a bad zone is not trusted.
assert.strictEqual(parseWhen('2026-11-14T19:30:00Z', 'America/Los_Angeles').toISOString(), '2026-11-14T19:30:00.000Z');
assert.strictEqual(parseWhen('2026-11-14T19:30:00-05:00', 'Asia/Tokyo').toISOString(), '2026-11-15T00:30:00.000Z');
assert.ok(parseWhen('2026-11-14T19:30', 'Not/AZone') instanceof Date, 'an unknown zone falls back to the plain reading');
assert.strictEqual(parseWhen('', 'UTC'), null);
assert.strictEqual(parseWhen('soon', 'UTC'), null);

// The forms: date pickers, plain labels, the time zone filled from the device; no ISO instructions left.
const views = fs.readFileSync(path.join(__dirname, '..', 'server', 'views', 'index.js'), 'utf8');
assert.match(views, /<input name="starts_at" type="datetime-local"/);
assert.match(views, /<input name="closes_at" type="datetime-local"/);
assert.doesNotMatch(views, /ISO time|YYYY-MM-DDTHH|placeholder="ada"/);
assert.match(views, /input\[name=timezone\]\[data-auto\]/, 'the device time zone fills the field');
assert.match(views, /<input type="hidden" name="timezone" value="\$\{esc\(v\.timezone \|\| 'UTC'\)\}" data-auto>/, 'the quest board sends a time zone too');
console.log('plan times: date pickers read in the plan time zone; no ISO typing');
