BEGIN;

DO $$
DECLARE
    test_user_id UUID;
    test_society_id UUID;
    test_email TEXT := 'test-' || gen_random_uuid()::TEXT || '@example.com';
    test_phone TEXT;
    constraint_name TEXT;
BEGIN
    -- Find an unused, correctly formatted test number.
    LOOP
        test_phone := '+919' ||
            lpad(floor(random() * 1000000000)::BIGINT::TEXT, 9, '0');

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM users WHERE phone = test_phone
        );
    END LOOP;

    INSERT INTO users (full_name, email, phone)
    VALUES ('Database Test User', test_email, test_phone)
    RETURNING id INTO test_user_id;

    -- Test 1: An unverified account cannot become active.
    BEGIN
        UPDATE users
        SET status = 'active'
        WHERE id = test_user_id;

        RAISE EXCEPTION 'FAIL: Unverified account became active.';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS
                constraint_name = CONSTRAINT_NAME;

            IF constraint_name <> 'active_user_requires_verification' THEN
                RAISE;
            END IF;

            RAISE NOTICE 'PASS: Unverified account activation blocked.';
    END;

    -- Test 2: A duplicate email must be rejected.
    BEGIN
        INSERT INTO users (full_name, email, phone)
        VALUES ('Duplicate Test User', test_email, test_phone);

        RAISE EXCEPTION 'FAIL: Duplicate account was accepted.';
    EXCEPTION
        WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS
                constraint_name = CONSTRAINT_NAME;

            IF constraint_name NOT IN ('users_email_key', 'users_phone_key') THEN
                RAISE;
            END IF;

            RAISE NOTICE 'PASS: Duplicate account blocked.';
    END;

    -- Positive check: A valid society record must be accepted.
    INSERT INTO societies (
        name,
        address_line_1,
        city,
        state_or_union_territory,
        pin_code,
        wing_count,
        total_units,
        one_bhk_units,
        created_by
    )
    VALUES (
        'Temporary Test Society',
        '123 Test Road',
        'Pune',
        'Maharashtra',
        '411001',
        0,
        1,
        1,
        test_user_id
    )
    RETURNING id INTO test_society_id;

    RAISE NOTICE 'PASS: Valid society record accepted.';

    -- Test 3: Unit counts must match the declared total.
    BEGIN
        UPDATE societies
        SET total_units = 2
        WHERE id = test_society_id;

        RAISE EXCEPTION 'FAIL: Incorrect unit total was accepted.';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS
                constraint_name = CONSTRAINT_NAME;

            IF constraint_name <> 'residential_unit_total_matches' THEN
                RAISE;
            END IF;

            RAISE NOTICE 'PASS: Incorrect unit total blocked.';
    END;
END;
$$;

ROLLBACK;