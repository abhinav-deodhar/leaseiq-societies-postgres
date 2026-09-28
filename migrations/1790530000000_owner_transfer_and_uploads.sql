-- Up Migration
ALTER TABLE resident_documents DROP CONSTRAINT resident_documents_kind_check;
ALTER TABLE resident_documents ADD CONSTRAINT resident_documents_kind_check
 CHECK(kind IN ('identity','rental_agreement','ownership_proof'));
ALTER TABLE resident_documents DROP CONSTRAINT resident_documents_purpose;
ALTER TABLE resident_documents ADD CONSTRAINT resident_documents_purpose CHECK (
 (kind IN ('identity','ownership_proof') AND request_id IS NOT NULL AND subject_user_id IS NOT NULL
  AND uploaded_by=subject_user_id AND tenancy_id IS NULL AND agreement_version IS NULL)
 OR (kind='rental_agreement' AND request_id IS NULL AND subject_user_id IS NULL
  AND tenancy_id IS NOT NULL AND agreement_version>0));
CREATE TABLE owner_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 society_id uuid NOT NULL REFERENCES societies(id),
 unit_id uuid NOT NULL,
 request_id uuid NOT NULL REFERENCES resident_unit_requests(id),
 request_revision integer NOT NULL CHECK(request_revision>0),
 incoming_user_id uuid NOT NULL REFERENCES users(id),
 created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'awaiting_confirmation'
  CHECK(status IN ('awaiting_confirmation','ready','disputed','completed','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 evidence_id uuid NOT NULL REFERENCES resident_documents(id),
 evidence_sha256 text NOT NULL,
 note text NOT NULL CHECK(char_length(btrim(note)) BETWEEN 10 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '14 days',
 completed_at timestamptz,
 completed_by uuid REFERENCES users(id),
 FOREIGN KEY(unit_id,society_id) REFERENCES society_units(id,society_id),
 CHECK(created_by<>incoming_user_id),
 CHECK((status='completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL) OR (status<>'completed' AND completed_at IS NULL AND completed_by IS NULL))
);
CREATE UNIQUE INDEX owner_transfers_one_open_flat ON owner_transfers(unit_id)
 WHERE status IN ('awaiting_confirmation','ready','disputed');
CREATE TABLE owner_transfer_participants (
 transfer_id uuid NOT NULL REFERENCES owner_transfers(id),
 membership_id uuid NOT NULL REFERENCES resident_unit_memberships(id),
 user_id uuid NOT NULL REFERENCES users(id),
 response text NOT NULL DEFAULT 'pending' CHECK(response IN ('pending','confirmed','disputed')),
 responded_at timestamptz,
 note text,
 PRIMARY KEY(transfer_id,membership_id),
 UNIQUE(transfer_id,user_id),
 CHECK((response='pending')=(responded_at IS NULL))
);
CREATE TABLE owner_transfer_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transfer_id uuid NOT NULL REFERENCES owner_transfers(id),
 actor_user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL CHECK(action IN ('requested','confirmed','disputed','completed','cancelled')),
 note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX owner_transfer_participant_inbox ON owner_transfer_participants(user_id,transfer_id);
CREATE INDEX owner_transfer_society_inbox ON owner_transfers(society_id,created_at,id);
CREATE INDEX owner_transfers_request_idx ON owner_transfers(request_id);
CREATE INDEX owner_transfers_evidence_idx ON owner_transfers(evidence_id);
CREATE INDEX owner_transfer_events_history_idx ON owner_transfer_events(transfer_id,created_at,id);
CREATE TABLE resident_upload_attempts (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 1
);
CREATE TABLE owner_transfer_auth_attempts (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 1
);
-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Forward-only: preserve transfer and document audit history. Restore a reviewed backup for rollback.'; END $$;
