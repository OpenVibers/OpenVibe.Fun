'use strict';
/**
 * No looks in public AI/curated text: a summary that names looks becomes the item's title; an ordinary summary is
 * kept. A person's own suggestion is not rewritten by this module — the safety filter and reports handle it.
 */
const assert = require('assert');
const { cleanSummary, hasLooks } = require('../server/text/no-looks');
const { check, done } = require('./helpers/boot');

(async () => {
    await check('a summary that names looks becomes the title', async () => {
        assert.strictEqual(cleanSummary('Find the best bench', 'A shirtless man in a kitchen laughs.'), 'Find the best bench');
        assert.ok(hasLooks('A woman with long red hair smiles.'));
    });

    await check('an ordinary summary survives and the empty case becomes the title', async () => {
        const s = cleanSummary('Find the best bench', 'A quiet bench above the river, ten minutes from the station.');
        assert.strictEqual(s, 'A quiet bench above the river, ten minutes from the station.');
        assert.strictEqual(cleanSummary('Find the best bench', ''), 'Find the best bench');
        assert.strictEqual(cleanSummary(null, null), 'Something to do');
    });

    done();
})();
