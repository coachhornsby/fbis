---
name: fbis-espn
description: Read-only ESPN scores, team identities and game summaries
---
# FBIS ESPN
Use espn_scoreboard, espn_summary, espn_teams and fbis_espn_status. Use today's date in America/Chicago unless the user supplies another date. Date format is YYYYMMDD. Follow nextOffset for complete schedules or directories. Read-only; no scheduled polling or automatic betting. ESPN data has no model or wagering authority. Preserve receivedAt separately from sourceHttpDate, sourceLastModified and sourceUpdatedAt. A null source timestamp means ESPN did not provide one; never substitute the fetch time. Report isError and upstream HTTP failures. Pregame zero scores are not live scores. ESPN feeds are undocumented. CFB scoreboards cover FBS, but ESPN's football team directory includes other divisions. CBB schedules can include non-Division-I opponents. Never fabricate data.
