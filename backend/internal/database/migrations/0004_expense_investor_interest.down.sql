-- Reverting requires no rows to use the new category.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_valid;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_valid
    CHECK (category IN ('Personal','Office','Savings'));
