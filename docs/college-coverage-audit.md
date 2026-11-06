# College coverage verification

This operation tests *data family visibility*, not complete game or historical population.

- 16 bounded requests across authenticated CFBD and CBBD APIs.
- Source/team/season scoped where appropriate; no bulk game/plays archive, Cloudflare, R2, D1 or production model mutation.
- Each probe records an HTTP status, record count, ID/null indicators, response checksum, capture time, and missing response flags.
- Current 2026–27 CBBD ratings may legitimately be empty early in the season. Prior 2025–26 ratings are **not** current 2026–27 observations.
- Full coverage is **never** inferred from successful sampling. Date-partitioned game and team/player box counts need independent ESPN/NCAA reconciliation, including FBS/FCS and Division I classification.
- The report is not a complete game file. Every source family must subsequently be imported, checked for unique IDs, point-in-time timestamp integrity, coverage parity, field-level completeness, and scheduled refresh before any production promotion.
- One-time automatic push workflow, plus explicit manual dispatch. No cron. GitHub Actions secret must already exist. Providers may have a shared quota; no follow-up fan-out is authorized here.
