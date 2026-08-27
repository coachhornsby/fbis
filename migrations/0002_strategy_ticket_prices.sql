-- FBIS research integrity migration 0002
-- Adds ticket price / qualification columns. Apply once (schema_migrations).

ALTER TABLE strategy_tickets ADD COLUMN qualified_at TEXT;
ALTER TABLE strategy_tickets ADD COLUMN execution_line REAL;
ALTER TABLE strategy_tickets ADD COLUMN execution_price REAL;
ALTER TABLE strategy_tickets ADD COLUMN benchmark_line REAL;
ALTER TABLE strategy_tickets ADD COLUMN benchmark_price REAL;
ALTER TABLE strategy_tickets ADD COLUMN entry_no_vig REAL;
ALTER TABLE strategy_tickets ADD COLUMN closing_line REAL;
ALTER TABLE strategy_tickets ADD COLUMN closing_price REAL;
ALTER TABLE strategy_tickets ADD COLUMN closing_no_vig REAL;
ALTER TABLE strategy_tickets ADD COLUMN stake REAL;
ALTER TABLE strategy_tickets ADD COLUMN missing_execution_price INTEGER;
