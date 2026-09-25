-- Up Migration

CREATE TABLE resident_unit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    unit_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),

    relationship TEXT NOT NULL
        CHECK (relationship IN ('owner', 'tenant')),

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'pending', 'approved', 'rejected', 'withdrawn'
        )),

    move_in_date DATE,
    tenancy_end_date DATE,

    applicant_note TEXT
        CHECK (
            applicant_note IS NULL
            OR char_length(btrim(applicant_note)) BETWEEN 1 AND 1000
        ),

    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    submitted_at TIMESTAMPTZ,

    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    review_note TEXT
        CHECK (
            review_note IS NULL
            OR char_length(btrim(review_note)) BETWEEN 1 AND 1000
        ),

    CONSTRAINT resident_requests_unit_society_fk
        FOREIGN KEY (unit_id, society_id)
        REFERENCES society_units(id, society_id),

    CONSTRAINT resident_requests_id_society_unique
        UNIQUE (id, society_id),

    CONSTRAINT resident_requests_identity_unique
        UNIQUE (id, society_id, unit_id, user_id, relationship),

    CONSTRAINT resident_requests_tenancy_dates CHECK (
        (relationship = 'tenant' OR tenancy_end_date IS NULL)
        AND (
            tenancy_end_date IS NULL
            OR (
                move_in_date IS NOT NULL
                AND tenancy_end_date >= move_in_date
            )
        )
    ),

    CONSTRAINT resident_requests_submission_consistent CHECK (
        (status = 'draft' AND submitted_at IS NULL)
        OR (status IN ('pending', 'approved', 'rejected')
            AND submitted_at IS NOT NULL)
        OR status = 'withdrawn'
    ),

    CONSTRAINT resident_requests_review_consistent CHECK (
        (
            status IN ('approved', 'rejected')
            AND reviewed_at IS NOT NULL
            AND reviewed_by IS NOT NULL
            AND submitted_at IS NOT NULL
            AND reviewed_at >= submitted_at
        )
        OR (
            status IN ('draft', 'pending', 'withdrawn')
            AND reviewed_at IS NULL
            AND reviewed_by IS NULL
            AND review_note IS NULL
        )
    ),

    CONSTRAINT resident_requests_rejection_reason CHECK (
        status <> 'rejected' OR review_note IS NOT NULL
    )
);

-- A user cannot open competing owner/tenant requests for the same flat.
CREATE UNIQUE INDEX resident_requests_one_open_per_flat
    ON resident_unit_requests(user_id, unit_id)
    WHERE status IN ('draft', 'pending');

CREATE INDEX resident_requests_user_history_idx
    ON resident_unit_requests(user_id, created_at DESC, id DESC);

CREATE INDEX resident_requests_review_queue_idx
    ON resident_unit_requests(society_id, submitted_at, id)
    WHERE status = 'pending';

CREATE INDEX resident_requests_unit_idx
    ON resident_unit_requests(unit_id, society_id);


CREATE TABLE resident_unit_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    unit_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),

    relationship TEXT NOT NULL
        CHECK (relationship IN ('owner', 'tenant')),

    source_request_id UUID NOT NULL UNIQUE,

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),

    approved_by UUID NOT NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    move_in_date DATE,
    tenancy_end_date DATE,

    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id),
    revocation_reason TEXT,

    CONSTRAINT resident_memberships_unit_society_fk
        FOREIGN KEY (unit_id, society_id)
        REFERENCES society_units(id, society_id),

    -- Approval cannot attach a request to another user, flat or role.
    CONSTRAINT resident_memberships_source_identity_fk
        FOREIGN KEY (
            source_request_id, society_id, unit_id, user_id, relationship
        )
        REFERENCES resident_unit_requests (
            id, society_id, unit_id, user_id, relationship
        ),

    CONSTRAINT resident_memberships_id_society_unique
        UNIQUE (id, society_id),

    CONSTRAINT resident_memberships_tenancy_dates CHECK (
        (relationship = 'tenant' OR tenancy_end_date IS NULL)
        AND (
            tenancy_end_date IS NULL
            OR (
                move_in_date IS NOT NULL
                AND tenancy_end_date >= move_in_date
            )
        )
    ),

    CONSTRAINT resident_memberships_revocation_consistent CHECK (
        (
            status = 'active'
            AND revoked_at IS NULL
            AND revoked_by IS NULL
            AND revocation_reason IS NULL
        )
        OR (
            status = 'revoked'
            AND revoked_at IS NOT NULL
            AND revoked_at >= approved_at
            AND revoked_by IS NOT NULL
            AND revocation_reason IS NOT NULL
            AND char_length(btrim(revocation_reason)) BETWEEN 1 AND 1000
        )
    )
);

-- Multiple people may belong to a flat; each person has one active
-- owner/tenant relationship with that flat.
CREATE UNIQUE INDEX resident_memberships_one_active_per_flat
    ON resident_unit_memberships(user_id, unit_id)
    WHERE status = 'active';

CREATE INDEX resident_memberships_society_unit_idx
    ON resident_unit_memberships(society_id, unit_id, status);

CREATE INDEX resident_memberships_user_idx
    ON resident_unit_memberships(user_id, status);

CREATE INDEX resident_memberships_tenancy_end_idx
    ON resident_unit_memberships(tenancy_end_date)
    WHERE status = 'active' AND relationship = 'tenant';


CREATE TABLE resident_unit_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    request_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL
        CHECK (action IN (
            'created',
            'updated',
            'submitted',
            'approved',
            'rejected',
            'withdrawn',
            'membership_revoked'
        )),

    request_revision INTEGER NOT NULL CHECK (request_revision > 0),

    details JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details) = 'object'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT resident_request_events_same_society_fk
        FOREIGN KEY (request_id, society_id)
        REFERENCES resident_unit_requests(id, society_id)
);

CREATE INDEX resident_request_events_history_idx
    ON resident_unit_request_events(request_id, created_at, id);

-- Down Migration

DROP TABLE resident_unit_request_events;
DROP TABLE resident_unit_memberships;
DROP TABLE resident_unit_requests;
