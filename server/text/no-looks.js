'use strict';

/**
 * No looks in public AI/curated text (the network rule, openvibe-sdk/no-looks, shared with Live, Community and
 * MediaHub): a summary we write never describes a person's body, clothing, hair, face or guessed gender. A summary
 * that names looks at all is not repaired word by word — it is replaced by the item's title. A person's own
 * suggestion or plan text is not passed through this (that would rewrite what they wrote); the safety filter and
 * reports handle those.
 */
const { noLooks, hasLooks } = require('openvibe-sdk/no-looks');

/** The summary to store for text Fun generated or curated. */
function cleanSummary(title, summary) {
    const t = String(title || '').trim() || 'Something to do';
    const s = String(summary == null ? '' : summary).trim();
    if (!s) return t;
    if (hasLooks(s)) return t;
    const cleaned = String(noLooks(s) || '').trim();
    return cleaned || t;
}

module.exports = { cleanSummary, noLooks, hasLooks };
