-- Up Migration

CREATE TABLE resident_tenancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    unit_id UUID NOT NULL,

    created_by UUID NOT NULL REFERENCES users(id),

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'ended', 'cancelled')),

    starts_on DATE NOT NULL,
    ends_on DATE,

    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    ended_at TIMESTAMPTZ,
    ended_by UUID REFERENCES users(id),
    end_reason TEXT,

    CONSTRAINT resident_tenancies_unit_society_fk
        FOREIGN KEY (unit_id, society_id)
        REFERENCES society_units(id, society_id),

    CONSTRAINT resident_tenancies_identity_unique
        UNIQUE (id, society_id, unit_id),

    CONSTRAINT resident_tenancies_id_society_unique
        UNIQUE (id, society_id),

    CONSTRAINT resident_tenancies_dates CHECK (
        ends_on IS NULL OR ends_on >= starts_on
    ),

    CONSTRAINT resident_tenancies_end_metadata CHECK (
        (
            status IN ('draft', 'active')
            AND ended_at IS NULL
            AND ended_by IS NULL
            AND end_reason IS NULL
        )
        OR (
            status IN ('ended', 'cancelled')
            AND ended_at IS NOT NULL
            AND ended_at >= created_at
            AND ended_by IS NOT NULL
            AND end_reason IS NOT NULL
            AND char_length(btrim(end_reason)) BETWEEN 1 AND 1000
        )
    )
);

CREATE INDEX resident_tenancies_unit_idx
    ON resident_tenancies(society_id, unit_id, status);

CREATE INDEX resident_tenancies_creator_idx
    ON resident_tenancies(created_by);

CREATE INDEX resident_tenancies_expiry_idx
    ON resident_tenancies(ends_on)
    WHERE status = 'active';


ALTER TABLE resident_unit_requests
    ADD COLUMN tenancy_id UUID,
    ADD COLUMN owner_review_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (owner_review_status IN (
            'not_required', 'pending', 'approved', 'rejected'
        )),
    ADD COLUMN owner_reviewed_at TIMESTAMPTZ,
    ADD COLUMN owner_reviewed_by UUID REFERENCES users(id),
    ADD COLUMN owner_review_note TEXT;

-- Existing tenant drafts will wait for owner review when submitted.
UPDATE resident_unit_requests
SET owner_review_status = 'pending'
WHERE relationship = 'tenant';

ALTER TABLE resident_unit_requests
    ADD CONSTRAINT resident_requests_tenancy_same_flat_fk
        FOREIGN KEY (tenancy_id, society_id, unit_id)
        REFERENCES resident_tenancies(id, society_id, unit_id),

    ADD CONSTRAINT resident_requests_tenancy_relationship CHECK (
        (relationship = 'owner' AND tenancy_id IS NULL)
        OR relationship = 'tenant'
    ),

    ADD CONSTRAINT resident_requests_owner_review_relationship CHECK (
        (
            relationship = 'owner'
            AND owner_review_status = 'not_required'
        )
        OR (
            relationship = 'tenant'
            AND owner_review_status IN ('pending', 'approved', 'rejected')
        )
    ),

    ADD CONSTRAINT resident_requests_owner_review_metadata CHECK (
        (
            owner_review_status IN ('not_required', 'pending')
            AND owner_reviewed_at IS NULL
            AND owner_reviewed_by IS NULL
            AND owner_review_note IS NULL
        )
        OR (
            owner_review_status IN ('approved', 'rejected')
            AND submitted_at IS NOT NULL
            AND owner_reviewed_at IS NOT NULL
            AND owner_reviewed_at >= submitted_at
            AND owner_reviewed_by IS NOT NULL
            AND owner_reviewed_by <> user_id
        )
    ),

    ADD CONSTRAINT resident_requests_owner_review_note_length CHECK (
        owner_review_note IS NULL
        OR char_length(btrim(owner_review_note)) BETWEEN 1 AND 1000
    ),

    ADD CONSTRAINT resident_requests_owner_rejection_reason CHECK (
        owner_review_status <> 'rejected'
        OR owner_review_note IS NOT NULL
    ),

    ADD CONSTRAINT resident_requests_submitted_tenancy CHECK (
        relationship <> 'tenant'
        OR status IN ('draft', 'withdrawn')
        OR tenancy_id IS NOT NULL
    ),

    ADD CONSTRAINT resident_requests_tenant_approval_order CHECK (
        relationship <> 'tenant'
        OR status <> 'approved'
        OR owner_review_status = 'approved'
    );

CREATE INDEX resident_requests_tenancy_idx
    ON resident_unit_requests(tenancy_id)
    WHERE tenancy_id IS NOT NULL;

CREATE INDEX resident_requests_owner_queue_idx
    ON resident_unit_requests(society_id, unit_id, submitted_at, id)
    WHERE relationship = 'tenant'
      AND status = 'pending'
      AND owner_review_status = 'pending';

CREATE INDEX resident_requests_chairman_queue_idx
    ON resident_unit_requests(society_id, submitted_at, id)
    WHERE status = 'pending'
      AND owner_review_status IN ('not_required', 'approved');


CREATE TABLE resident_tenancy_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    society_id UUID NOT NULL REFERENCES societies(id),
    tenancy_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL CHECK (action IN (
        'created',
        'updated',
        'activated',
        'ended',
        'cancelled',
        'agreement_uploaded',
        'agreement_replaced',
        'participant_confirmed',
        'participant_removed'
    )),

    details JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details) = 'object'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT resident_tenancy_events_same_society_fk
        FOREIGN KEY (tenancy_id, society_id)
        REFERENCES resident_tenancies(id, society_id)
);

CREATE INDEX resident_tenancy_events_history_idx
    ON resident_tenancy_events(tenancy_id, created_at, id);


-- Down Migration

DROP TABLE resident_tenancy_events;

ALTER TABLE resident_unit_requests
    DROP CONSTRAINT resident_requests_tenant_approval_order,
    DROP CONSTRAINT resident_requests_submitted_tenancy,
    DROP CONSTRAINT resident_requests_owner_rejection_reason,
    DROP CONSTRAINT resident_requests_owner_review_note_length,
    DROP CONSTRAINT resident_requests_owner_review_metadata,
    DROP CONSTRAINT resident_requests_owner_review_relationship,
    DROP CONSTRAINT resident_requests_tenancy_relationship,
    DROP CONSTRAINT resident_requests_tenancy_same_flat_fk;

ALTER TABLE resident_unit_requests
    DROP COLUMN owner_review_note,
    DROP COLUMN owner_reviewed_by,
    DROP COLUMN owner_reviewed_at,
    DROP COLUMN owner_review_status,
    DROP COLUMN tenancy_id;

DROP TABLE resident_tenancies;
