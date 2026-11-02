'use strict';
// What openvibe.fun tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json.
// Every field is something this site really serves: the JSON API under /api/v1, the developers page that
// documents it, and the app's own per-address limits. No OpenAPI document or MCP endpoint is published.
module.exports = {
    id: 'fun',
    name: 'OpenVibe.Fun',
    purpose: 'Something to do, alone, together, or live: IRL quests on OpenVibe.Live, a local guide from OpenStreetMap, and group plans that the group votes on.',
    home: 'https://openvibe.fun',
    site: 'openvibe.fun',
    api: '/api/v1',
    docs: '/developers',
    policy: {
        auth: ['none', 'Network OIDC'],
        rateLimit: '300 page requests a minute per address; 240 API requests a minute; sign-in limited to 60 attempts per 15 minutes',
    },
};
