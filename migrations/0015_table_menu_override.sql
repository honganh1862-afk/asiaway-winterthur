-- The menu a member of staff sets for a table (Vietnamese, Thai or both),
-- instead of the day's schedule. NULL: the schedule applies. Clearing the table
-- after paying sets it back to NULL, so the next guests get the schedule.
ALTER TABLE restaurant_tables
  ADD COLUMN IF NOT EXISTS menu_override text;

ALTER TABLE restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_menu_override_valid;
ALTER TABLE restaurant_tables
  ADD CONSTRAINT restaurant_tables_menu_override_valid
  CHECK (menu_override IS NULL OR menu_override IN ('VIETNAMESE', 'THAI', 'BOTH'));
