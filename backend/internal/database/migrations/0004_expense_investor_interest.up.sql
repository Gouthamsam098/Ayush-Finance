-- Investor interest is a distinct business cost (money paid to people who
-- funded the book), so it gets its own expense category rather than being
-- buried under Office. Investments auto-post their interest payouts here, so
-- investor cost stays separable in every expense report.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_valid;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_valid
    CHECK (category IN ('Personal','Office','Savings','Investor Interest'));
