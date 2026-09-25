-- Up Migration

CREATE TABLE invoice_notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id UUID NOT NULL REFERENCES societies(id),
    invoice_id UUID NOT NULL,

    event_type TEXT NOT NULL DEFAULT 'invoice_issued'
        CHECK (event_type = 'invoice_issued'),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    -- Processing means the notification has been handed to the
    -- notification system. It does not mean a person has read it.
    processed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    UNIQUE (invoice_id, event_type),

    FOREIGN KEY (invoice_id, society_id)
        REFERENCES society_invoices(id, society_id)
);

CREATE INDEX invoice_notification_pending_idx
    ON invoice_notification_outbox(next_attempt_at, created_at, id)
    WHERE processed_at IS NULL;

-- Down Migration

DROP TABLE invoice_notification_outbox;
