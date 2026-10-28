-- phase: expand
-- OpenVibe.Fun v1: IRL quests on Live, a local guide from OpenStreetMap (Ticketmaster only when a key is set), and
-- group plans. Nothing here is a credential. A quest/plan is public community text; a vote, suggestion, report and
-- badge is a person's own row to export or erase (server/identity/account-data.js). OSM/Ticketmaster answers are
-- cached public data, never personal data.

-- ── IRL quests ────────────────────────────────────────────────
-- A streamer opens one board on their Live channel for one session. Viewers suggest quests; the board stays
-- unlisted, and only the quest the streamer accepts becomes public.
CREATE TABLE fun_quest_boards (
    id              text COLLATE "C" PRIMARY KEY,              -- qbd_ + ULID
    streamer_subject text COLLATE "C",                         -- usr_…; NULL after an account deletion
    live_username   text COLLATE "C" NOT NULL,
    chat_username   text COLLATE "C" NOT NULL,                 -- the public Chat channel the votes are read from
    title           text NOT NULL,
    city            text,
    lat             double precision,
    lon             double precision,
    accessible_only boolean NOT NULL DEFAULT false,
    max_suggestions integer NOT NULL DEFAULT 30,
    status          text COLLATE "C" NOT NULL DEFAULT 'open',  -- open | accepted | closed
    accepted_quest_id text COLLATE "C",
    opens_at        timestamptz NOT NULL DEFAULT now(),
    closes_at       timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_quest_boards_id CHECK (id ~ '^qbd_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_boards_subject CHECK (streamer_subject IS NULL OR streamer_subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_boards_username CHECK (live_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$' AND chat_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT fun_quest_boards_title CHECK (length(title) BETWEEN 3 AND 120),
    CONSTRAINT fun_quest_boards_city CHECK (city IS NULL OR length(city) BETWEEN 1 AND 120),
    CONSTRAINT fun_quest_boards_lat CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    CONSTRAINT fun_quest_boards_lon CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
    CONSTRAINT fun_quest_boards_suggestions CHECK (max_suggestions BETWEEN 1 AND 100),
    CONSTRAINT fun_quest_boards_status CHECK (status IN ('open', 'accepted', 'closed')),
    CONSTRAINT fun_quest_boards_window CHECK (closes_at > opens_at)
);
CREATE INDEX fun_quest_boards_open ON fun_quest_boards (status, closes_at) WHERE status = 'open';
CREATE INDEX fun_quest_boards_by_streamer ON fun_quest_boards (streamer_subject, created_at DESC);

CREATE TABLE fun_quests (
    id               text COLLATE "C" PRIMARY KEY,             -- qst_ + ULID
    board_id         text COLLATE "C" NOT NULL REFERENCES fun_quest_boards (id) ON DELETE CASCADE,
    slug             text COLLATE "C" NOT NULL UNIQUE,
    title            text NOT NULL,
    brief            text NOT NULL,
    category         text COLLATE "C" NOT NULL,                -- near_me | outside | brainy | silly | chill
    source           text COLLATE "C" NOT NULL,                -- suggestion | chat | idea | streamer
    status           text COLLATE "C" NOT NULL DEFAULT 'suggested', -- suggested | accepted | live | completed | verified | rejected | hidden
    visibility       text COLLATE "C" NOT NULL DEFAULT 'unlisted',  -- public | unlisted | hidden
    city             text,
    lat              double precision,
    lon              double precision,
    place_name       text,
    accessible       boolean NOT NULL DEFAULT false,
    streamer_username text COLLATE "C" NOT NULL,
    chat_username    text COLLATE "C" NOT NULL,
    stream_url       text NOT NULL,
    created_by       text COLLATE "C",                         -- usr_…; NULL for chat/idea suggestions and after deletion
    chat_author      text COLLATE "C",                         -- public chat username, when source = chat
    revision         bigint NOT NULL DEFAULT 1,
    accepted_at      timestamptz,
    completed_at     timestamptz,
    verified_at      timestamptz,
    verified_by      text COLLATE "C",
    verification     text COLLATE "C",                         -- chat | moderator
    reward_badge     text COLLATE "C",
    reward_coins     integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_quests_id CHECK (id ~ '^qst_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quests_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 80),
    CONSTRAINT fun_quests_title CHECK (length(title) BETWEEN 3 AND 120),
    CONSTRAINT fun_quests_brief CHECK (length(brief) BETWEEN 3 AND 1200),
    CONSTRAINT fun_quests_category CHECK (category IN ('near_me', 'outside', 'brainy', 'silly', 'chill')),
    CONSTRAINT fun_quests_source CHECK (source IN ('suggestion', 'chat', 'idea', 'streamer')),
    CONSTRAINT fun_quests_status CHECK (status IN ('suggested', 'accepted', 'live', 'completed', 'verified', 'rejected', 'hidden')),
    CONSTRAINT fun_quests_visibility CHECK (visibility IN ('public', 'unlisted', 'hidden')),
    CONSTRAINT fun_quests_public_only_when_accepted CHECK (visibility <> 'public' OR status IN ('accepted', 'live', 'completed', 'verified')),
    CONSTRAINT fun_quests_city CHECK (city IS NULL OR length(city) BETWEEN 1 AND 120),
    CONSTRAINT fun_quests_lat CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    CONSTRAINT fun_quests_lon CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
    CONSTRAINT fun_quests_place CHECK (place_name IS NULL OR length(place_name) BETWEEN 1 AND 200),
    CONSTRAINT fun_quests_streamer CHECK (streamer_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$' AND chat_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'),
    CONSTRAINT fun_quests_stream_url CHECK (stream_url ~ '^https://'),
    CONSTRAINT fun_quests_created_by CHECK (created_by IS NULL OR created_by ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quests_chat_author CHECK (chat_author IS NULL OR length(chat_author) BETWEEN 1 AND 64),
    CONSTRAINT fun_quests_revision CHECK (revision > 0),
    CONSTRAINT fun_quests_verification CHECK (verification IS NULL OR verification IN ('chat', 'moderator')),
    CONSTRAINT fun_quests_coins CHECK (reward_coins BETWEEN 0 AND 500)
);
CREATE INDEX fun_quests_public ON fun_quests (visibility, status, created_at DESC);
CREATE INDEX fun_quests_by_board ON fun_quests (board_id, created_at DESC);
CREATE INDEX fun_quests_by_streamer ON fun_quests (streamer_username, created_at DESC);
CREATE INDEX fun_quests_verified ON fun_quests (verified_at DESC) WHERE status = 'verified';
ALTER TABLE fun_quest_boards
    ADD CONSTRAINT fun_quest_boards_accepted_quest FOREIGN KEY (accepted_quest_id) REFERENCES fun_quests (id) ON DELETE SET NULL;

-- One vote per person (or one per public chat username) per quest. A chat vote carries the message id so a re-read
-- of the same public history changes nothing.
CREATE TABLE fun_quest_votes (
    quest_id        text COLLATE "C" NOT NULL REFERENCES fun_quests (id) ON DELETE CASCADE,
    voter           text COLLATE "C" NOT NULL,                 -- usr_… for a person, chat:<username> for chat
    subject         text COLLATE "C",                          -- usr_… only for a person
    via             text COLLATE "C" NOT NULL DEFAULT 'web',   -- web | chat
    chat_message_id text COLLATE "C",
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (quest_id, voter),
    CONSTRAINT fun_quest_votes_voter CHECK (voter ~ '^(usr_[0-9A-HJKMNP-TV-Z]{26}|chat:.{1,64})$'),
    CONSTRAINT fun_quest_votes_subject CHECK (subject IS NULL OR subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_votes_via CHECK (via IN ('web', 'chat'))
);
CREATE INDEX fun_quest_votes_by_quest ON fun_quest_votes (quest_id, created_at);
CREATE UNIQUE INDEX fun_quest_votes_chat_message ON fun_quest_votes (chat_message_id) WHERE chat_message_id IS NOT NULL;

-- A chat vote on whether a completed quest is done. The streamer/owner may verify via chat once enough distinct
-- public chat voters have said so; a Network moderator may verify directly.
CREATE TABLE fun_quest_checks (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quest_id        text COLLATE "C" NOT NULL REFERENCES fun_quests (id) ON DELETE CASCADE,
    voter           text COLLATE "C" NOT NULL,
    subject         text COLLATE "C",
    via             text COLLATE "C" NOT NULL DEFAULT 'chat',   -- chat | moderator
    chat_message_id text COLLATE "C",
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_quest_checks_voter CHECK (voter ~ '^(usr_[0-9A-HJKMNP-TV-Z]{26}|chat:.{1,64}|staff:.{1,64})$'),
    CONSTRAINT fun_quest_checks_subject CHECK (subject IS NULL OR subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_checks_via CHECK (via IN ('chat', 'moderator')),
    UNIQUE (quest_id, voter)
);
CREATE INDEX fun_quest_checks_by_quest ON fun_quest_checks (quest_id, created_at);
CREATE UNIQUE INDEX fun_quest_checks_chat_message ON fun_quest_checks (chat_message_id) WHERE chat_message_id IS NOT NULL;

-- A local badge is free and always paid on verification. OpenCoins live in fun_quest_rewards and are credited only
-- when FUN_COINS=on (loyalty points, never money). Neither table holds a token.
CREATE TABLE fun_badges (
    quest_id    text COLLATE "C" NOT NULL REFERENCES fun_quests (id) ON DELETE CASCADE,
    subject     text COLLATE "C" NOT NULL,
    badge_id    text COLLATE "C" NOT NULL,
    name        text NOT NULL,
    awarded_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (quest_id, subject),
    CONSTRAINT fun_badges_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_badges_badge CHECK (badge_id ~ '^fun_[a-z0-9_]{2,60}$'),
    CONSTRAINT fun_badges_name CHECK (length(name) BETWEEN 1 AND 120)
);
CREATE INDEX fun_badges_by_subject ON fun_badges (subject, awarded_at DESC);

CREATE TABLE fun_quest_rewards (
    id          text COLLATE "C" PRIMARY KEY,                  -- qrw_ + ULID
    quest_id    text COLLATE "C" NOT NULL REFERENCES fun_quests (id) ON DELETE CASCADE,
    subject     text COLLATE "C" NOT NULL,
    coins       integer NOT NULL DEFAULT 0,
    state       text COLLATE "C" NOT NULL DEFAULT 'pending',   -- pending | credited | skipped | failed
    detail      text,
    attempts    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (quest_id, subject),
    CONSTRAINT fun_quest_rewards_id CHECK (id ~ '^qrw_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_rewards_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_quest_rewards_coins CHECK (coins BETWEEN 0 AND 500),
    CONSTRAINT fun_quest_rewards_state CHECK (state IN ('pending', 'credited', 'skipped', 'failed'))
);
CREATE INDEX fun_quest_rewards_pending ON fun_quest_rewards (state, updated_at) WHERE state IN ('pending', 'failed');

-- ── Group plans ───────────────────────────────────────────────
-- A plan is the group's shared record. Its owner may delete their account: the owner column becomes NULL and the
-- plan and other people's votes stay, because the plan is not one person's private row.
CREATE TABLE fun_plans (
    id              text COLLATE "C" PRIMARY KEY,              -- pln_ + ULID
    slug            text COLLATE "C" NOT NULL UNIQUE,
    owner_subject   text COLLATE "C",
    owner_username  text COLLATE "C",
    title           text NOT NULL,
    summary         text,
    city            text,
    lat             double precision,
    lon             double precision,
    timezone        text NOT NULL DEFAULT 'UTC',
    starts_at       timestamptz NOT NULL,
    closes_at       timestamptz NOT NULL,
    status          text COLLATE "C" NOT NULL DEFAULT 'voting', -- voting | decided | cancelled
    winner_option_id text COLLATE "C",
    visibility      text COLLATE "C" NOT NULL DEFAULT 'unlisted', -- public | unlisted | hidden
    revision        bigint NOT NULL DEFAULT 1,
    chat_username   text COLLATE "C",
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_plans_id CHECK (id ~ '^pln_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_plans_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 80),
    CONSTRAINT fun_plans_owner CHECK (owner_subject IS NULL OR owner_subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_plans_owner_name CHECK (owner_username IS NULL OR length(owner_username) BETWEEN 1 AND 64),
    CONSTRAINT fun_plans_title CHECK (length(title) BETWEEN 3 AND 120),
    CONSTRAINT fun_plans_summary CHECK (summary IS NULL OR length(summary) <= 1200),
    CONSTRAINT fun_plans_city CHECK (city IS NULL OR length(city) BETWEEN 1 AND 120),
    CONSTRAINT fun_plans_lat CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    CONSTRAINT fun_plans_lon CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
    CONSTRAINT fun_plans_timezone CHECK (length(timezone) BETWEEN 1 AND 80),
    CONSTRAINT fun_plans_window CHECK (closes_at <= starts_at),
    CONSTRAINT fun_plans_status CHECK (status IN ('voting', 'decided', 'cancelled')),
    CONSTRAINT fun_plans_visibility CHECK (visibility IN ('public', 'unlisted', 'hidden')),
    CONSTRAINT fun_plans_revision CHECK (revision > 0),
    CONSTRAINT fun_plans_chat CHECK (chat_username IS NULL OR chat_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$')
);
CREATE INDEX fun_plans_public ON fun_plans (visibility, status, starts_at ASC);
CREATE INDEX fun_plans_by_owner ON fun_plans (owner_subject, created_at DESC);

CREATE TABLE fun_plan_options (
    id          text COLLATE "C" PRIMARY KEY,                  -- pop_ + ULID
    plan_id     text COLLATE "C" NOT NULL REFERENCES fun_plans (id) ON DELETE CASCADE,
    title       text NOT NULL,
    details     text,
    place_name  text,
    lat         double precision,
    lon         double precision,
    accessible  boolean NOT NULL DEFAULT false,
    price_note  text,
    starts_at   timestamptz,
    created_by  text COLLATE "C",                              -- usr_…; NULL after deletion
    position    integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_plan_options_id CHECK (id ~ '^pop_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_plan_options_title CHECK (length(title) BETWEEN 1 AND 120),
    CONSTRAINT fun_plan_options_details CHECK (details IS NULL OR length(details) <= 1200),
    CONSTRAINT fun_plan_options_place CHECK (place_name IS NULL OR length(place_name) BETWEEN 1 AND 200),
    CONSTRAINT fun_plan_options_lat CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    CONSTRAINT fun_plan_options_lon CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
    CONSTRAINT fun_plan_options_price CHECK (price_note IS NULL OR length(price_note) <= 80),
    CONSTRAINT fun_plan_options_created_by CHECK (created_by IS NULL OR created_by ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_plan_options_position CHECK (position BETWEEN 1 AND 10),
    UNIQUE (plan_id, position)
);
CREATE INDEX fun_plan_options_by_plan ON fun_plan_options (plan_id, position);

ALTER TABLE fun_plans
    ADD CONSTRAINT fun_plans_winner_option FOREIGN KEY (winner_option_id) REFERENCES fun_plan_options (id) ON DELETE SET NULL;

CREATE TABLE fun_plan_votes (
    plan_id         text COLLATE "C" NOT NULL REFERENCES fun_plans (id) ON DELETE CASCADE,
    voter           text COLLATE "C" NOT NULL,
    subject         text COLLATE "C",
    option_id       text COLLATE "C" NOT NULL REFERENCES fun_plan_options (id) ON DELETE CASCADE,
    via             text COLLATE "C" NOT NULL DEFAULT 'web',
    chat_message_id text COLLATE "C",
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, voter),
    CONSTRAINT fun_plan_votes_voter CHECK (voter ~ '^(usr_[0-9A-HJKMNP-TV-Z]{26}|chat:.{1,64})$'),
    CONSTRAINT fun_plan_votes_subject CHECK (subject IS NULL OR subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_plan_votes_via CHECK (via IN ('web', 'chat'))
);
CREATE INDEX fun_plan_votes_by_option ON fun_plan_votes (plan_id, option_id);
CREATE UNIQUE INDEX fun_plan_votes_chat_message ON fun_plan_votes (chat_message_id) WHERE chat_message_id IS NOT NULL;

-- ── Safety, chat ingestion and the OSM/Ticketmaster cache ─────
CREATE TABLE fun_reports (
    id          text COLLATE "C" PRIMARY KEY,                  -- frp_ + ULID
    target_kind text COLLATE "C" NOT NULL,                     -- quest | plan
    target_id   text COLLATE "C" NOT NULL,
    subject     text COLLATE "C" NOT NULL,
    kind        text COLLATE "C" NOT NULL,                     -- safety | spam | other
    reason      text NOT NULL,
    note        text,
    status      text COLLATE "C" NOT NULL DEFAULT 'open',      -- open | handled | dismissed
    created_at  timestamptz NOT NULL DEFAULT now(),
    handled_at  timestamptz,
    handled_by  text COLLATE "C",
    CONSTRAINT fun_reports_id CHECK (id ~ '^frp_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_reports_target CHECK (target_kind IN ('quest', 'plan')),
    CONSTRAINT fun_reports_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_reports_kind CHECK (kind IN ('safety', 'spam', 'other')),
    CONSTRAINT fun_reports_reason CHECK (length(reason) BETWEEN 3 AND 2000),
    CONSTRAINT fun_reports_note CHECK (note IS NULL OR length(note) <= 4000),
    CONSTRAINT fun_reports_status CHECK (status IN ('open', 'handled', 'dismissed'))
);
CREATE INDEX fun_reports_open ON fun_reports (status, created_at);

-- One row per public chat message already read, so a redelivered page is idempotent even when the command itself
-- writes something else (a vote, a suggestion, a check).
CREATE TABLE fun_chat_seen (
    chat_username text COLLATE "C" NOT NULL,
    message_id    text COLLATE "C" NOT NULL,
    seen_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_username, message_id),
    CONSTRAINT fun_chat_seen_username CHECK (chat_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$')
);
CREATE INDEX fun_chat_seen_at ON fun_chat_seen (seen_at);

-- How far each public chat channel has been read. `after_id` is Chat's own cursor; the seen table above is the
-- second, content-level guard, so a channel read twice still creates one vote.
CREATE TABLE fun_chat_cursors (
    chat_username  text COLLATE "C" PRIMARY KEY,
    last_message_id text COLLATE "C",
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_chat_cursors_username CHECK (chat_username ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$')
);

-- The shared cache for Nominatim/Overpass and Ticketmaster. body is public JSON, never a secret and never a person.
CREATE TABLE fun_geo_cache (
    key        text COLLATE "C" PRIMARY KEY,
    body       jsonb NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX fun_geo_cache_expiry ON fun_geo_cache (expires_at);

-- The Search Fabric outbox (Meme/Today shape). A public quest or plan queues one document in the same transaction;
-- hiding or deleting it queues a tombstone. Rows wait until OpenVibe.Search's document writer is configured for
-- `fun` (the relay is deliberately not in v1; it needs the search.document.write grant).
CREATE TABLE fun_outbox (
    event_id       text COLLATE "C" PRIMARY KEY,
    topic          text COLLATE "C" NOT NULL,
    payload        jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,
    attempts       integer NOT NULL DEFAULT 0,
    last_error     text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at     timestamptz,
    claimed_by     text
);
CREATE INDEX fun_outbox_pending ON fun_outbox (next_attempt_at) WHERE published_at IS NULL;

-- openvibe-sdk/account-data keeps its own idempotency here (ADR-033): a redelivered export or deletion changes
-- nothing. It holds an export_id or deletion_id, the subject and the counts sent to Network; it is not a secret.
CREATE TABLE account_data_events (
    id         text PRIMARY KEY,
    kind       text NOT NULL,
    subject    text NOT NULL,
    outcome    jsonb,
    applied_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz
);

-- Request telemetry (openvibe-sdk/telemetry): one row per aggregated sample, pruned after 14 days.
CREATE TABLE telemetry_samples (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                    timestamptz NOT NULL,
    service               text NOT NULL,
    project               text,
    subject               text,
    resource              text,
    provider              text,
    node                  text,
    cell                  text,
    region                text,
    operation             text NOT NULL,
    latency_ms            double precision,
    queue_delay_ms        double precision,
    ttfb_ms               double precision,
    throughput_per_second double precision,
    bytes                 bigint,
    status                text,
    cache_status          text,
    cost_estimate         double precision,
    route_epoch           bigint,
    trace_id              text,
    extra                 jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX telemetry_samples_at_idx ON telemetry_samples (at);
CREATE INDEX telemetry_samples_service_idx ON telemetry_samples (service, operation, at);
