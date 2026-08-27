-- ML / F5 ML line is a point, never an American price.

UPDATE strategy_tickets
SET line = NULL,
    execution_line = CASE WHEN ABS(COALESCE(execution_line, 0)) >= 100 THEN NULL ELSE execution_line END,
    benchmark_line = CASE WHEN ABS(COALESCE(benchmark_line, 0)) >= 100 THEN NULL ELSE benchmark_line END
WHERE market IN ('ML', 'F5 ML')
  AND (
    (line IS NOT NULL AND ABS(line) >= 100)
    OR (execution_line IS NOT NULL AND ABS(execution_line) >= 100)
    OR (benchmark_line IS NOT NULL AND ABS(benchmark_line) >= 100)
  );

INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('0004_ml_line_is_not_price', datetime('now'));
