-- Up Migration

CREATE TABLE society_unit_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),

    name TEXT NOT NULL
        CHECK (
            name = btrim(name)
            AND char_length(name) BETWEEN 1 AND 100
        ),

    category TEXT NOT NULL
        CHECK (category IN (
            'studio',
            'one_bhk',
            'two_bhk',
            'three_bhk',
            'four_plus_bhk',
            'custom'
        )),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT society_unit_types_id_society_unique
        UNIQUE (id, society_id)
);

CREATE UNIQUE INDEX society_unit_types_name_unique
    ON society_unit_types(society_id, lower(name));

-- Standard categories occur once per society.
-- Multiple named custom types are permitted.
CREATE UNIQUE INDEX society_unit_types_standard_category_unique
    ON society_unit_types(society_id, category)
    WHERE category <> 'custom';

CREATE TABLE society_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),

    -- NULL means not yet classified.
    unit_type_id UUID,

    -- Empty wing means this society has no wing designation.
    wing TEXT NOT NULL DEFAULT ''
        CHECK (
            wing = btrim(wing)
            AND char_length(wing) <= 50
        ),

    -- Labels can be G, 1, 2, etc. Do not convert them to numbers.
    floor_label TEXT
        CHECK (
            floor_label IS NULL
            OR (
                floor_label = btrim(floor_label)
                AND char_length(floor_label) BETWEEN 1 AND 50
            )
        ),

    flat_number TEXT NOT NULL
        CHECK (
            flat_number = btrim(flat_number)
            AND char_length(flat_number) BETWEEN 1 AND 50
        ),

    occupancy_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (occupancy_status IN (
            'unknown',
            'vacant',
            'owner_occupied',
            'rented'
        )),

    revision INTEGER NOT NULL DEFAULT 1
        CHECK (revision >= 1),

    created_by UUID NOT NULL REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT society_units_id_society_unique
        UNIQUE (id, society_id),

    -- Prevent attaching a unit type from another society.
    CONSTRAINT society_units_type_same_society_fk
        FOREIGN KEY (unit_type_id, society_id)
        REFERENCES society_unit_types(id, society_id)
);

-- Floor is descriptive, not part of the flat's identity.
CREATE UNIQUE INDEX society_units_address_unique
    ON society_units(
        society_id,
        lower(btrim(wing)),
        lower(btrim(flat_number))
    );

CREATE INDEX society_units_type_idx
    ON society_units(society_id, unit_type_id);

CREATE TABLE unit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    unit_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL
        CHECK (action IN (
            'created',
            'updated',
            'occupancy_updated'
        )),

    unit_revision INTEGER NOT NULL
        CHECK (unit_revision >= 1),

    snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(snapshot) = 'object'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT unit_events_unit_same_society_fk
        FOREIGN KEY (unit_id, society_id)
        REFERENCES society_units(id, society_id),

    CONSTRAINT unit_events_revision_unique
        UNIQUE (unit_id, unit_revision)
);

CREATE INDEX unit_events_history_idx
    ON unit_events(society_id, unit_id, created_at, id);

-- Add standard type choices for societies that already exist.
-- This does not create flats or alter application unit counts.
INSERT INTO society_unit_types (society_id, name, category)
SELECT s.id, t.name, t.category
FROM societies s
CROSS JOIN (
    VALUES
        ('Studio / 1 RK', 'studio'),
        ('1 BHK', 'one_bhk'),
        ('2 BHK', 'two_bhk'),
        ('3 BHK', 'three_bhk'),
        ('4+ BHK', 'four_plus_bhk')
) AS t(name, category);

-- Down Migration

DROP TABLE unit_events;
DROP TABLE society_units;
DROP TABLE society_unit_types;
