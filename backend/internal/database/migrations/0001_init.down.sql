-- Rollback of migration 0001. Drops in reverse dependency order.
DROP SEQUENCE IF EXISTS receipt_no_seq;
DROP SEQUENCE IF EXISTS loan_number_seq;
DROP SEQUENCE IF EXISTS customer_code_seq;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS loans;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS users;
