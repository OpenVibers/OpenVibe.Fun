'use strict';

/**
 * The IRL quest safety filter. A quest may be playful and social — the plan's own example, "get a stranger to
 * beatbox", is allowed — but it may never be dangerous, illegal, trespassing or harassment. Suggestions and chat
 * commands are checked here before a row is written; the streamer can set further limits on the board
 * (accessible_only, max_suggestions), and a person can report a public quest for staff review.
 *
 * This is a deliberately small, explainable list, not a model: a false negative is a report, and a false positive
 * is a refusal with the rule named. It never inspects or describes a person.
 */

const MAX_TITLE = 120;
const MAX_BRIEF = 600;
const CATEGORIES = Object.freeze(['near_me', 'outside', 'brainy', 'silly', 'chill']);

const RULES = Object.freeze([
    {
        code: 'danger',
        why: 'That challenge could put someone in danger.',
        re: /\b(trespass(?:ing)?|break(?:ing)?\s+(?:in|into)|sneak(?:ing)?\s+into|rooftops?|roof(?:s|top)?|train\s?surf(?:ing)?|jump(?:ing)?\s+off|climb(?:ing)?\s+(?:a\s+)?(?:bridge|building|crane|tower)|highways?|freeways?|oncoming\s+traffic|set\s+(?:it|something)\s+on\s+fire|play(?:ing)?\s+with\s+fire|fireworks?\s+at|guns?|weapons?|knives|knife|bleach|poison|swim(?:ming)?\s+across|drunk|drugs?|dare(?:s|d)?\s+(?:someone|a\s+stranger))\b/i,
    },
    {
        code: 'harassment',
        why: 'That challenge asks someone to harass or touch another person.',
        re: /\b(harass(?:ing|ment)?|catcall(?:ing)?|follow(?:ing)?\s+(?:a\s+)?stranger|record(?:ing)?\s+(?:a\s+)?stranger|upskirt|grope|touch(?:ing)?\s+(?:a\s+)?(?:stranger|someone)|kiss(?:ing)?\s+(?:a\s+)?stranger|fight(?:ing)?|punch(?:ing)?|slap(?:ping)?|prank(?:ing)?\s+(?:a\s+)?stranger)\b/i,
    },
    {
        code: 'illegal',
        why: 'That challenge asks for something illegal.',
        re: /\b(steal(?:ing)?|shoplift(?:ing)?|vandal(?:ism|ize|izing)?|graffiti|spray\s?paint(?:ing)?|trespass(?:ing)?|break(?:ing)?\s+(?:in|into)|jaywalk(?:ing)?)\b/i,
    },
    {
        code: 'adult',
        why: 'That challenge is not suitable for a public stream.',
        re: /\b(naked|nude|strip(?:ping|tease)?|porn(?:ography)?|sex(?:ual)?|escort)\b/i,
    },
]);

function normalize(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The refusal for text, or null when it is safe. Never echoes the text back in the code. */
function refusal(text) {
    for (const rule of RULES) if (rule.re.test(text)) return { code: `fun.quest.${rule.code}`, why: rule.why };
    return null;
}

/** Check one suggestion title/brief pair. Returns { ok, title, brief } or { ok:false, status, code, message, field }. */
function checkSuggestion({ title, brief } = {}) {
    const t = normalize(title).slice(0, MAX_TITLE + 1);
    const b = normalize(brief || title).slice(0, MAX_BRIEF + 1);
    if (t.length < 3 || t.length > MAX_TITLE) return { ok: false, status: 400, code: 'fun.quest.invalid', field: 'title', message: `title must be 3 to ${MAX_TITLE} characters` };
    if (b.length < 3 || b.length > MAX_BRIEF) return { ok: false, status: 400, code: 'fun.quest.invalid', field: 'brief', message: `brief must be 3 to ${MAX_BRIEF} characters` };
    const hit = refusal(`${t} ${b}`);
    if (hit) return { ok: false, status: 422, code: hit.code, field: 'title', message: hit.why };
    return { ok: true, title: t, brief: b };
}

/** A chat command's text is a suggestion title until a board max applies; same rules. */
function checkChatSuggestion(text) {
    return checkSuggestion({ title: text, brief: text });
}

function checkCategory(value, allowed = CATEGORIES) {
    const c = normalize(value).toLowerCase().replace(/[\s-]+/g, '_');
    if (!allowed.includes(c)) return { ok: false, status: 400, code: 'fun.quest.invalid', field: 'category', message: `category must be one of ${allowed.join(', ')}` };
    return { ok: true, value: c };
}

module.exports = { checkSuggestion, checkChatSuggestion, checkCategory, normalize, refusal, RULES, CATEGORIES, MAX_TITLE, MAX_BRIEF };
