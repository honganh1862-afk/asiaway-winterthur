-- Three courses (1 starter, 2 main course, 3 dessert), special requests, and
-- the staff's confirmation of an order.
--
-- A line's confirmed_quantity is how much of it the staff have confirmed (and
-- sent to the kitchen); what is above it is new and waits for confirmation.
-- Guests can add to a line but never take it below what is confirmed.
ALTER TABLE table_cart_lines
  DROP CONSTRAINT IF EXISTS table_cart_lines_course_valid;
ALTER TABLE table_cart_lines
  ADD CONSTRAINT table_cart_lines_course_valid CHECK (course IN (1, 2, 3));

ALTER TABLE table_cart_lines
  ADD COLUMN IF NOT EXISTS confirmed_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE table_cart_lines
  DROP CONSTRAINT IF EXISTS table_cart_lines_confirmed_valid;
ALTER TABLE table_cart_lines
  ADD CONSTRAINT table_cart_lines_confirmed_valid CHECK (confirmed_quantity BETWEEN 0 AND 99);

-- A special request for one dish ("no peanuts"), from a guest or the staff.
ALTER TABLE table_cart_lines
  ADD COLUMN IF NOT EXISTS note text;

-- A special request for the whole table, and what the staff last confirmed.
ALTER TABLE table_carts
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS confirmed_note text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by text;
