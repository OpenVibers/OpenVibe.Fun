'use strict';

/**
 * The safe starter quests. These are a small catalogue in code, not an AI generation: the only "generation" in v1
 * is choosing one of these for a streamer (POST /quests/:slug/idea), so no model call and no new AI capability is
 * involved. Every one passes server/quests/safety.js, and they are written without describing anyone's looks.
 */
const IDEAS = Object.freeze([
    { title: 'Find the oldest bar on this street', brief: 'Ask a local or look at the date over the door; tell chat what you found.', category: 'near_me', accessible: false },
    { title: 'Get a stranger to beatbox', brief: 'Ask politely, keep it short, and stop if they are not up for it.', category: 'silly', accessible: true },
    { title: 'Find the best bench with a view', brief: 'Walk ten minutes, sit for one minute, and show chat the view.', category: 'chill', accessible: true },
    { title: 'Find a mural nobody has shown chat', brief: 'Take a photo from the pavement, not from the road.', category: 'outside', accessible: true },
    { title: 'Order the cheapest thing on the menu', brief: 'Ask the staff what it is and tell chat how it tasted.', category: 'brainy', accessible: true },
    { title: 'Find a shop that sells only one thing', brief: 'Ask what it is and why; no purchase needed.', category: 'near_me', accessible: true },
    { title: 'Follow the next left turn three times', brief: 'Stay on public pavements and let chat see where you end up.', category: 'outside', accessible: false },
    { title: 'Learn one word in a language you do not speak', brief: 'Ask someone at a bus stop or a shop, politely, and use it once.', category: 'brainy', accessible: true },
]);

function forBoard({ accessibleOnly = false, excludeTitles = [] } = {}) {
    const seen = new Set((excludeTitles || []).map((t) => String(t).toLowerCase()));
    return IDEAS.filter((i) => (!accessibleOnly || i.accessible) && !seen.has(i.title.toLowerCase()));
}

module.exports = { IDEAS, forBoard };
