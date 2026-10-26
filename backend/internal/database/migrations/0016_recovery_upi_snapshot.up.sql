-- Recovery records kept on the server instead of the agent's browser.
--
-- 1. The UPI ID a UPI collection was paid to. Stamped by the SERVER from the
--    loan type's UPI settings (loan_type_upi) when the agent files the claim —
--    never from client input — and copied onto the collection rows when the
--    claim is approved, so Reports show it on every device. NULL for other
--    modes, and for rows recorded before this change.
ALTER TABLE recovery_submissions ADD COLUMN payee_vpa  VARCHAR(256);
ALTER TABLE recovery_submissions ADD COLUMN payee_name VARCHAR(80);
ALTER TABLE collections          ADD COLUMN payee_vpa  VARCHAR(256);
ALTER TABLE collections          ADD COLUMN payee_name VARCHAR(80);

-- 2. When the agent last edited a pending claim (the activity history's
--    "Collect updated"). updated_at also moves on review, so it cannot say this.
ALTER TABLE recovery_submissions ADD COLUMN edited_at TIMESTAMPTZ;
