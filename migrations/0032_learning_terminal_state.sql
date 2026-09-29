ALTER TABLE prediction_snapshots ADD COLUMN learning_terminal_state TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN learning_exclusion_reason TEXT;
ALTER TABLE prediction_snapshots ADD COLUMN learning_terminal_at TEXT;

CREATE INDEX IF NOT EXISTS idx_snap_learning_terminal
  ON prediction_snapshots (learning_terminal_state, sport, date);
