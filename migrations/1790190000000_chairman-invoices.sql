-- Up Migration

CREATE TABLE invoice_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    created_by UUID NOT NULL REFERENCES users(id),

    -- Retrying the same draft creation must not create another draft.
    request_key UUID NOT NULL,

    title TEXT NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),

    billing_month DATE NOT NULL
        CHECK (EXTRACT(DAY FROM billing_month) = 1),

    due_date DATE NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),

    target_kind TEXT NOT NULL
        CHECK (target_kind IN ('unit', 'unit_type')),

    target_unit_id UUID,
    target_unit_type_id UUID,

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'cancelled')),

    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    issued_at TIMESTAMPTZ,
    issued_by UUID REFERENCES users(id),

    UNIQUE (id, society_id),
    UNIQUE (society_id, request_key),

    FOREIGN KEY (target_unit_id, society_id)
        REFERENCES society_units(id, society_id),

    FOREIGN KEY (target_unit_type_id, society_id)
        REFERENCES society_unit_types(id, society_id),

    CHECK (
        (
            target_kind = 'unit'
            AND target_unit_id IS NOT NULL
            AND target_unit_type_id IS NULL
        )
        OR
        (
            target_kind = 'unit_type'
            AND target_unit_id IS NULL
            AND target_unit_type_id IS NOT NULL
        )
    ),

    CHECK (
        (
            status = 'issued'
            AND issued_at IS NOT NULL
            AND issued_by IS NOT NULL
        )
        OR
        (
            status IN ('draft', 'cancelled')
            AND issued_at IS NULL
            AND issued_by IS NULL
        )
    )
);

CREATE INDEX invoice_drafts_society_created_idx
    ON invoice_drafts(society_id, created_at DESC, id DESC);

CREATE TABLE invoice_draft_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL REFERENCES invoice_drafts(id),
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 20),
    description TEXT NOT NULL
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),

    -- Integer paise. Maximum ₹10,00,000 per line.
    amount_paise BIGINT NOT NULL
        CHECK (amount_paise BETWEEN 1 AND 100000000),

    UNIQUE (draft_id, position)
);

-- The service locks this row when allocating invoice numbers.
-- Numbers are unique within a society and never reused after voiding.
CREATE TABLE society_invoice_counters (
    society_id UUID PRIMARY KEY REFERENCES societies(id),
    last_number BIGINT NOT NULL DEFAULT 0
        CHECK (last_number BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE society_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    draft_id UUID NOT NULL,
    unit_id UUID NOT NULL,

    invoice_number BIGINT NOT NULL
        CHECK (invoice_number BETWEEN 1 AND 9007199254740991),

    title TEXT NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    billing_month DATE NOT NULL
        CHECK (EXTRACT(DAY FROM billing_month) = 1),
    due_date DATE NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),

    total_paise BIGINT NOT NULL
        CHECK (total_paise BETWEEN 1 AND 2000000000),

    -- Issued documents retain their original details when units change.
    society_snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(society_snapshot) = 'object'),
    unit_snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(unit_snapshot) = 'object'),
    lines_snapshot JSONB NOT NULL
        CHECK (
            CASE WHEN jsonb_typeof(lines_snapshot) = 'array'
                THEN jsonb_array_length(lines_snapshot) BETWEEN 1 AND 20
                ELSE false
            END
        ),

    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'void')),

    issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    issued_by UUID NOT NULL REFERENCES users(id),

    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES users(id),
    void_reason TEXT,

    UNIQUE (id, society_id),
    UNIQUE (society_id, invoice_number),
    UNIQUE (draft_id, unit_id),

    FOREIGN KEY (draft_id, society_id)
        REFERENCES invoice_drafts(id, society_id),

    FOREIGN KEY (unit_id, society_id)
        REFERENCES society_units(id, society_id),

    CHECK (
        (
            status = 'issued'
            AND voided_at IS NULL
            AND voided_by IS NULL
            AND void_reason IS NULL
        )
        OR
        (
            status = 'void'
            AND voided_at IS NOT NULL
            AND voided_at >= issued_at
            AND voided_by IS NOT NULL
            AND void_reason IS NOT NULL
            AND char_length(btrim(void_reason)) BETWEEN 1 AND 500
        )
    )
);

CREATE INDEX society_invoices_society_issued_idx
    ON society_invoices(society_id, issued_at DESC, id DESC);

CREATE INDEX society_invoices_unit_idx
    ON society_invoices(society_id, unit_id, issued_at DESC);

CREATE INDEX society_invoices_due_idx
    ON society_invoices(society_id, due_date)
    WHERE status = 'issued';

CREATE TABLE invoice_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    draft_id UUID NOT NULL,
    invoice_id UUID,
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL CHECK (action IN (
        'draft_created',
        'draft_updated',
        'draft_cancelled',
        'invoice_issued',
        'invoice_voided'
    )),

    snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    FOREIGN KEY (draft_id, society_id)
        REFERENCES invoice_drafts(id, society_id),

    FOREIGN KEY (invoice_id, society_id)
        REFERENCES society_invoices(id, society_id),

    CHECK (
        (action IN ('invoice_issued', 'invoice_voided') AND invoice_id IS NOT NULL)
        OR
        (action IN ('draft_created', 'draft_updated', 'draft_cancelled')
            AND invoice_id IS NULL)
    )
);

CREATE INDEX invoice_events_draft_idx
    ON invoice_events(draft_id, created_at, id);

-- Down Migration

DROP TABLE invoice_events;
DROP TABLE society_invoices;
DROP TABLE society_invoice_counters;
DROP TABLE invoice_draft_lines;
DROP TABLE invoice_drafts;
