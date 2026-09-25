-- Up Migration
-- Billing contacts are records, not portal permissions. Resident onboarding can
-- link a verified user later without changing a historic bill's snapshot.
CREATE TABLE unit_billing_contacts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 society_id UUID NOT NULL REFERENCES societies(id),
 unit_id UUID NOT NULL,
 user_id UUID REFERENCES users(id),
 full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
 role TEXT NOT NULL CHECK (role IN ('owner', 'tenant')),
 starts_on DATE NOT NULL,
 ends_on DATE CHECK (ends_on >= starts_on),
 created_by UUID NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (unit_id, society_id) REFERENCES society_units(id, society_id)
);
CREATE INDEX unit_billing_contacts_unit_idx ON unit_billing_contacts(society_id, unit_id);

-- Only confirmed receipts count toward payment status. Gateway initiation is
-- not a receipt. Payment ingestion will use this ledger when integrated.
CREATE TABLE invoice_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 society_id UUID NOT NULL REFERENCES societies(id),
 invoice_id UUID NOT NULL,
 amount_paise BIGINT NOT NULL CHECK (amount_paise BETWEEN 1 AND 2000000000),
 source TEXT NOT NULL CHECK (source IN ('manual', 'gateway')),
 reference TEXT NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 1 AND 200),
 paid_at TIMESTAMPTZ NOT NULL,
 recorded_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 reversed_at TIMESTAMPTZ,
 reversal_reason TEXT,
 FOREIGN KEY (invoice_id, society_id) REFERENCES society_invoices(id, society_id),
 UNIQUE (society_id, source, reference),
 CHECK ((reversed_at IS NULL AND reversal_reason IS NULL) OR
   (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND reversed_at >= created_at AND char_length(btrim(reversal_reason)) BETWEEN 1 AND 500)),
 CHECK (source <> 'manual' OR recorded_by IS NOT NULL)
);
CREATE INDEX invoice_receipts_invoice_idx ON invoice_receipts(society_id, invoice_id);
CREATE FUNCTION validate_invoice_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill_total BIGINT; bill_status TEXT; received BIGINT;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Reverse a receipt instead of deleting it'; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF (to_jsonb(NEW) - 'reversed_at' - 'reversal_reason') IS DISTINCT FROM
      (to_jsonb(OLD) - 'reversed_at' - 'reversal_reason') OR OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL THEN
     RAISE EXCEPTION 'Only a first receipt reversal is allowed';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'New receipts cannot already be reversed'; END IF;
 SELECT total_paise, status INTO bill_total, bill_status FROM society_invoices
 WHERE id = NEW.invoice_id AND society_id = NEW.society_id FOR UPDATE;
 IF bill_status IS DISTINCT FROM 'issued' THEN RAISE EXCEPTION 'Receipt requires an issued bill'; END IF;
 SELECT COALESCE(SUM(amount_paise),0) INTO received FROM invoice_receipts
 WHERE invoice_id = NEW.invoice_id AND reversed_at IS NULL;
 IF received + NEW.amount_paise > bill_total THEN RAISE EXCEPTION 'Receipt exceeds outstanding balance'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_receipt_validation BEFORE INSERT OR UPDATE OR DELETE ON invoice_receipts
 FOR EACH ROW EXECUTE FUNCTION validate_invoice_receipt();

-- Down Migration
DROP TABLE invoice_receipts;
DROP FUNCTION validate_invoice_receipt();
DROP TABLE unit_billing_contacts;
