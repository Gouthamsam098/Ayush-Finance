DROP TRIGGER IF EXISTS trg_loans_cascade_soft_delete ON loans;
DROP FUNCTION IF EXISTS loans_cascade_soft_delete();
DROP VIEW IF EXISTS collections_live;
DROP VIEW IF EXISTS loans_live;
