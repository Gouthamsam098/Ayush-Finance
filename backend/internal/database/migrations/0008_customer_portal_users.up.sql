-- Customer portal logins: a borrower signs in as a `users` row with role
-- CUSTOMER, linked to exactly one customer record.
--
-- Until now portal logins lived only in the browser's localStorage, so the
-- backend rejected every request they made (no JWT) and the app logged them out.
-- Putting them in `users` gives them the same bcrypt + RS256 JWT path as staff.
--
-- A CUSTOMER has an empty permissions map, so RequirePermission already denies
-- them every staff module. They read their own data only through /portal/*,
-- which resolves the customer from the token, never from a request parameter.

ALTER TABLE users DROP CONSTRAINT users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid
    CHECK (role IN ('ADMIN','VIEWER','CUSTOMER'));

ALTER TABLE users ADD COLUMN customer_id BIGINT REFERENCES customers(id);

-- A CUSTOMER must be linked to a customer; staff never are.
ALTER TABLE users ADD CONSTRAINT users_customer_link
    CHECK ((role = 'CUSTOMER') = (customer_id IS NOT NULL));

-- At most one live portal login per customer.
CREATE UNIQUE INDEX idx_users_customer_live
    ON users(customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
