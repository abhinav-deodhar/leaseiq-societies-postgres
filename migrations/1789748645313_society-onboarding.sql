-- Up Migration

CREATE TABLE societies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),

    address_line_1 TEXT NOT NULL
        CHECK (char_length(btrim(address_line_1)) BETWEEN 5 AND 250),

    address_line_2 TEXT
        CHECK (
            address_line_2 IS NULL
            OR char_length(btrim(address_line_2)) BETWEEN 1 AND 250
        ),

    city TEXT NOT NULL
        CHECK (char_length(btrim(city)) BETWEEN 2 AND 100),

    state_or_union_territory TEXT NOT NULL
        CHECK (
            char_length(btrim(state_or_union_territory))
            BETWEEN 2 AND 100
        ),

    country_code TEXT NOT NULL DEFAULT 'IN'
        CHECK (country_code = 'IN'),

    pin_code TEXT NOT NULL
        CHECK (pin_code ~ '^[1-9][0-9]{5}$'),

    wing_count INTEGER NOT NULL
        CHECK (wing_count BETWEEN 0 AND 1000),

    total_units INTEGER NOT NULL
        CHECK (total_units BETWEEN 1 AND 100000),

    studio_units INTEGER NOT NULL DEFAULT 0
        CHECK (studio_units >= 0),

    one_bhk_units INTEGER NOT NULL DEFAULT 0
        CHECK (one_bhk_units >= 0),

    two_bhk_units INTEGER NOT NULL DEFAULT 0
        CHECK (two_bhk_units >= 0),

    three_bhk_units INTEGER NOT NULL DEFAULT 0
        CHECK (three_bhk_units >= 0),

    four_plus_bhk_units INTEGER NOT NULL DEFAULT 0
        CHECK (four_plus_bhk_units >= 0),

    other_residential_units INTEGER NOT NULL DEFAULT 0
        CHECK (other_residential_units >= 0),

    other_residential_description TEXT
        CHECK (
            other_residential_description IS NULL
            OR char_length(btrim(other_residential_description))
                BETWEEN 2 AND 200
        ),

    service_status TEXT NOT NULL DEFAULT 'inactive'
        CHECK (service_status IN ('inactive', 'active', 'suspended')),

    created_by UUID NOT NULL REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT residential_unit_total_matches CHECK (
        studio_units::BIGINT
        + one_bhk_units
        + two_bhk_units
        + three_bhk_units
        + four_plus_bhk_units
        + other_residential_units
        = total_units
    ),

    CONSTRAINT other_residential_units_explained CHECK (
        other_residential_units = 0
        OR other_residential_description IS NOT NULL
    )
);

CREATE TABLE society_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    user_id UUID NOT NULL REFERENCES users(id),

    role TEXT NOT NULL
        CHECK (role IN ('chairman', 'secretary')),

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'revoked')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT unique_society_user_role
        UNIQUE (society_id, user_id, role)
);

CREATE INDEX society_memberships_user_id_idx
    ON society_memberships(user_id);

CREATE UNIQUE INDEX one_current_chairman_per_society
    ON society_memberships(society_id)
    WHERE role = 'chairman' AND status IN ('pending', 'active');

CREATE UNIQUE INDEX one_current_secretary_per_society
    ON society_memberships(society_id)
    WHERE role = 'secretary' AND status IN ('pending', 'active');

CREATE TABLE society_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL UNIQUE REFERENCES societies(id),
    applicant_user_id UUID NOT NULL REFERENCES users(id),

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft',
            'pending_review',
            'changes_requested',
            'approved',
            'rejected'
        )),

    revision INTEGER NOT NULL DEFAULT 1
        CHECK (revision >= 1),

    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES platform_admins(user_id),

    review_note TEXT
        CHECK (
            review_note IS NULL
            OR char_length(btrim(review_note)) BETWEEN 1 AND 2000
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT submitted_application_has_timestamp CHECK (
        status = 'draft' OR submitted_at IS NOT NULL
    ),

    CONSTRAINT review_metadata_matches_status CHECK (
        (
            status IN ('draft', 'pending_review')
            AND reviewed_at IS NULL
            AND reviewed_by IS NULL
            AND review_note IS NULL
        )
        OR (
            status IN ('changes_requested', 'approved', 'rejected')
            AND reviewed_at IS NOT NULL
            AND reviewed_by IS NOT NULL
        )
    ),

    CONSTRAINT review_reason_required CHECK (
        status NOT IN ('changes_requested', 'rejected')
        OR review_note IS NOT NULL
    )
);

CREATE INDEX society_applications_review_queue_idx
    ON society_applications(status, submitted_at);

CREATE INDEX society_applications_applicant_idx
    ON society_applications(applicant_user_id);

CREATE TABLE application_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    application_id UUID NOT NULL REFERENCES society_applications(id),
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL
        CHECK (action IN (
            'submitted',
            'resubmitted',
            'changes_requested',
            'approved',
            'rejected'
        )),

    application_revision INTEGER NOT NULL
        CHECK (application_revision >= 1),

    note TEXT
        CHECK (
            note IS NULL
            OR char_length(btrim(note)) BETWEEN 1 AND 2000
        ),

    application_snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(application_snapshot) = 'object'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT event_reason_required CHECK (
        action NOT IN ('changes_requested', 'rejected')
        OR note IS NOT NULL
    )
);

CREATE INDEX application_events_history_idx
    ON application_events(application_id, created_at);

-- Down Migration

DROP TABLE application_events;
DROP TABLE society_applications;
DROP TABLE society_memberships;
DROP TABLE societies;