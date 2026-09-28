-- Up Migration

-- Application information only: these records do not create login
-- accounts, approve memberships, or verify a family member's contacts.
-- Existing drafts remain valid and can be completed later.
ALTER TABLE resident_unit_requests
    ADD COLUMN applicant_profile JSONB,
    ADD CONSTRAINT resident_applicant_profile_object CHECK (
        applicant_profile IS NULL
        OR (
            jsonb_typeof(applicant_profile) = 'object'
            AND octet_length(applicant_profile::text) <= 32768
        )
    );

-- Down Migration

ALTER TABLE resident_unit_requests
    DROP CONSTRAINT resident_applicant_profile_object,
    DROP COLUMN applicant_profile;
