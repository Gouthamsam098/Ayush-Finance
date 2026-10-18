DELETE FROM users WHERE role = 'CUSTOMER';
DROP INDEX IF EXISTS idx_users_customer_live;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_link;
ALTER TABLE users DROP COLUMN IF EXISTS customer_id;
ALTER TABLE users DROP CONSTRAINT users_role_valid;
ALTER TABLE users ADD CONSTRAINT users_role_valid CHECK (role IN ('ADMIN','VIEWER'));
