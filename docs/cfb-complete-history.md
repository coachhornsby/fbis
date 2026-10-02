# CFB Complete Historical Research Dataset

## Purpose

Build one canonical, leakage-safe college-football research dataset for FBIS from the deepest practical historical sources currently available to the project.

## Source layers

### CFBD primary layer
Coverage target: 2000-2026.

Includes:
- schedules and final scores
- provider-level betting lines, spreads, totals, opening fields, and moneylines when populated
- game PPA
- advanced game stats
- play-by-play aggregates
- drive aggregates
- player box-score retrieval
- Elo
- CORE
- prior-season SP+, FPI, SRS, and recruiting
- preseason talent and returning production
- weather

Historical play-by-play and analytics are reconstructed only from observations occurring before the target kickoff. Market fields are evaluation-only.

### SportsDataverse / ESPN enrichment
Coverage target: 2004-2026.

Used as an independent supplementary source for:
- schedule identity cross-checks
- pregame rankings/rest context when available
- QB identity when available
- resolved historical spread/total data

Placeholder/default betting rows are discarded. Only rows with explicit line availability and valid numeric fields can enrich the canonical market benchmark.

## Canonical market policy

1. Prefer sanitized CFBD provider median for a game.
2. If unavailable, use a valid SportsDataverse/ESPN resolved line.
3. Preserve all sanitized CFBD provider rows separately.
4. Preserve opening and moneyline values only when actually populated.
5. Never use any market field as an independent model feature.
6. Emit cross-source disagreement diagnostics for materially different lines.

## Temporal integrity

- rolling football features use only prior chronological games;
- season rolling features exclude the target game;
- CORE requires throughWeek strictly earlier than the target week;
- prior SP+/FPI/SRS/recruiting come from season-1;
- Elo is taken from the prior week;
- market data is benchmark/evaluation only.

## Fail-closed QA

The complete-history build refuses to pass if:
- duplicate canonical game IDs are present;
- the 2000-2026 season range is incomplete;
- market benchmarks are empty;
- post-2013 FBS training spread or total coverage falls below 95%;
- recent rich-feature coverage disappears;
- required CFBD game retrieval fails.

No model qualification or wager authorization is changed by this pipeline.
