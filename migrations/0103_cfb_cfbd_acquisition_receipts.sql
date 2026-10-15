-- 0103: one durable acquisition permit per CFBD endpoint/query per Chicago date.
-- This is a network receipt, never a projection or wagering authority grant.
CREATE TABLE IF NOT EXISTS cfb_cfbd_acquisition_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  blocked_until_ms INTEGER NOT NULL DEFAULT 0,
  last_429_at TEXT,
  last_remaining INTEGER
);
INSERT OR IGNORE INTO cfb_cfbd_acquisition_control(id) VALUES(1);

CREATE TABLE IF NOT EXISTS cfb_cfbd_acquisition_receipts (
  request_day TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_month TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_status TEXT NOT NULL CHECK (request_status IN ('reserved','ok','http_error','transport_error','rate_limited')),
  http_status INTEGER,
  records_count INTEGER,
  provider_remaining INTEGER,
  acquired_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY(request_day, request_hash)
);
CREATE INDEX IF NOT EXISTS idx_cfb_cfbd_receipts_month
ON cfb_cfbd_acquisition_receipts(request_month);
CREATE INDEX IF NOT EXISTS idx_cfb_cfbd_receipts_status
ON cfb_cfbd_acquisition_receipts(request_day, request_status);

INSERT OR IGNORE INTO schema_migrations (id, applied_at)
VALUES ('0103_cfb_cfbd_acquisition_receipts',datetime('now'));
