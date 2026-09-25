-- Up Migration

CREATE TABLE invoice_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    created_by UUID NOT NULL REFERENCES users(id),

    request_key UUID NOT NULL,
    title TEXT NOT NULL
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),

    frequency TEXT NOT NULL DEFAULT 'monthly'
        CHECK (frequency = 'monthly'),

    target_kind TEXT NOT NULL
        CHECK (target_kind IN ('unit', 'unit_type')),
    target_unit_id UUID,
    target_unit_type_id UUID,

    first_billing_month DATE NOT NULL
        CHECK (EXTRACT(DAY FROM first_billing_month) = 1),
    final_billing_month DATE
        CHECK (
            final_billing_month IS NULL
            OR (
                EXTRACT(DAY FROM final_billing_month) = 1
                AND final_billing_month >= first_billing_month
            )
        ),

    generation_day INTEGER NOT NULL
        CHECK (generation_day BETWEEN 1 AND 28),

    payment_window_days INTEGER NOT NULL
        CHECK (payment_window_days BETWEEN 1 AND 90),

    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
        CHECK (timezone = 'Asia/Kolkata'),
    currency TEXT NOT NULL DEFAULT 'INR'
        CHECK (currency = 'INR'),

    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'paused', 'ended')),

    -- First month still to be considered by the scheduler.
    next_billing_month DATE NOT NULL
        CHECK (
            EXTRACT(DAY FROM next_billing_month) = 1
            AND next_billing_month >= first_billing_month
        ),

    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

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
    )
);

CREATE INDEX invoice_schedules_due_idx
    ON invoice_schedules(next_billing_month, generation_day, id)
    WHERE status = 'active';

CREATE INDEX invoice_schedules_society_idx
    ON invoice_schedules(society_id, created_at DESC, id DESC);

CREATE TABLE invoice_schedule_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES invoice_schedules(id),
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 20),
    description TEXT NOT NULL
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
    amount_paise BIGINT NOT NULL
        CHECK (amount_paise BETWEEN 1 AND 100000000),

    UNIQUE (schedule_id, position)
);

CREATE TABLE invoice_schedule_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    schedule_id UUID NOT NULL,
    billing_month DATE NOT NULL
        CHECK (EXTRACT(DAY FROM billing_month) = 1),
    scheduled_date DATE NOT NULL,
    due_date DATE NOT NULL CHECK (due_date >= scheduled_date),

    schedule_revision INTEGER NOT NULL CHECK (schedule_revision > 0),
    schedule_snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(schedule_snapshot) = 'object'),

    status TEXT NOT NULL
        CHECK (status IN ('generated', 'skipped')),
    skip_reason TEXT,
    recipient_count INTEGER NOT NULL CHECK (recipient_count >= 0),
    draft_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    UNIQUE (id, society_id),
    UNIQUE (schedule_id, billing_month),
    UNIQUE (draft_id),

    FOREIGN KEY (schedule_id, society_id)
        REFERENCES invoice_schedules(id, society_id),
    FOREIGN KEY (draft_id, society_id)
        REFERENCES invoice_drafts(id, society_id),

    CHECK (
        (
            status = 'generated'
            AND draft_id IS NOT NULL
            AND recipient_count > 0
            AND skip_reason IS NULL
        )
        OR
        (
            status = 'skipped'
            AND draft_id IS NULL
            AND recipient_count = 0
            AND skip_reason IS NOT NULL
            AND char_length(btrim(skip_reason)) BETWEEN 1 AND 500
        )
    )
);

ALTER TABLE society_invoices
    ADD COLUMN schedule_run_id UUID;

ALTER TABLE society_invoices
    ADD CONSTRAINT society_invoices_schedule_run_fk
    FOREIGN KEY (schedule_run_id, society_id)
    REFERENCES invoice_schedule_runs(id, society_id);

CREATE UNIQUE INDEX society_invoices_run_unit_unique
    ON society_invoices(schedule_run_id, unit_id)
    WHERE schedule_run_id IS NOT NULL;

CREATE TABLE invoice_schedule_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    schedule_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id),

    action TEXT NOT NULL CHECK (action IN (
        'created', 'updated', 'activated', 'paused', 'resumed', 'ended'
    )),
    snapshot JSONB NOT NULL
        CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    FOREIGN KEY (schedule_id, society_id)
        REFERENCES invoice_schedules(id, society_id)
);

CREATE INDEX invoice_schedule_events_schedule_idx
    ON invoice_schedule_events(schedule_id, created_at, id);

-- Down Migration

DROP TABLE invoice_schedule_events;
DROP INDEX society_invoices_run_unit_unique;
ALTER TABLE society_invoices
    DROP CONSTRAINT society_invoices_schedule_run_fk;
ALTER TABLE society_invoices
    DROP COLUMN schedule_run_id;
DROP TABLE invoice_schedule_runs;
DROP TABLE invoice_schedule_lines;
DROP TABLE invoice_schedules;
