-- phase: expand
-- An unlisted list is shared through its random link; signed-in members may add sourced places.
CREATE TABLE fun_place_lists (
    id text COLLATE "C" PRIMARY KEY,
    owner_subject text COLLATE "C",
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fun_place_lists_owner CHECK (owner_subject IS NULL OR owner_subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT fun_place_lists_title CHECK (length(title) BETWEEN 3 AND 120)
);
CREATE TABLE fun_place_list_members (
    list_id text COLLATE "C" NOT NULL REFERENCES fun_place_lists(id) ON DELETE CASCADE,
    subject text COLLATE "C" NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, subject),
    CONSTRAINT fun_place_members_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
CREATE INDEX fun_place_list_members_subject ON fun_place_list_members(subject);
CREATE TABLE fun_place_list_items (
    id text COLLATE "C" PRIMARY KEY,
    list_id text COLLATE "C" NOT NULL REFERENCES fun_place_lists(id) ON DELETE CASCADE,
    place_name text NOT NULL,
    place_url text NOT NULL,
    added_by text COLLATE "C",
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (list_id, place_url),
    CONSTRAINT fun_place_items_name CHECK (length(place_name) BETWEEN 1 AND 200),
    CONSTRAINT fun_place_items_url CHECK (place_url ~ '^https://openvibe\.tours/place/[a-z0-9-]+-plc_[0-9A-HJKMNP-TV-Z]{26}$')
);
