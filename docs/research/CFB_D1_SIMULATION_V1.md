# CFB D1 research simulator v1

## Placement and ownership
- **Only** the existing `CFB_DB` binding (`fbis-cfb` D1) stores the simulation summaries/grades.
- `sql/cfb/0001_cfb_sim_shadow.sql` is a deliberately **CFB-only** schema. Do not add to the canonical `migrations/` pipeline, which deploys to `fbis` PRIMARY.
- No new Cloudflare account, database, data provider, or dedicated compute.
- Existing CFB production model and model-version-specific frozen `prediction_snapshots` remain the starting point.

## Algorithm v1
- CFB-FBIS-v2 only, using frozen pregame score predictions.
- Joint two-team empirical forecast errors resampled from **different prior games**.
- Every historical prediction must predate its own kickoff, and its actual settlement must **predate the target snapshot's freeze**.
- Latest valid pregame snapshot per historical game, never duplicate one game as many independent observations.
- Minimum 60 distinct historical, graded, temporally valid games; max 600.
- Weighted by distance in baseline projected total and margin, with 30% uniform mixing to retain tails.
- 5,000 deterministic draws per prospective event, seeded by snapshot and training fingerprint.
- Outputs home/away score, total/margin ranges, home-ahead frequency and modeled tie mass. **Tie-aware research numbers are not moneyline odds.**
- Only summary distributions are persisted, never 5,000 raw scores.
- This is **not** a possession/drive/play model or player-prop simulator yet. Actual drive/PBP modeling is stage 2 after a verified game-state training dataset is attached.

## Operational control
- `POST /api/cfb-simulation` with operator secret header and JSON `{"action":"freeze","gameId":"<id>"}`. The service accepts current prospective games only and inserts exactly one immutable summary per source snapshot.
- `POST /api/cfb-simulation` with `{"action":"grade","gameId":"<id>"}`. Inserts a separate grade receipt only when the canonical outcome was graded after kickoff.
- `GET /api/cfb-simulation` requires the operator header and reads recent compact receipts.
- All paths fail closed without CFB_DB, valid kickoff/timestamps, adequate historical evidence or installed CFB-only schema.
- No automatic schedule, no sportsbook/exchange writes, no confidence stars, no model promotion, no new market fetches.
- Production changes require passing CI, release checks, then independent prospective calibration and economic evidence.

## Training/data limitation
The October 22, 2026 audit saw ~10,377 CFB snapshot rows but only about 115 distinct cleanly dated games for CFB-FBIS-v2. Small samples are a **reason for research status**, not proof of 80/90% coverage. These numbers will change as new finals arrive and the model is stabilized.

## Next milestone
A drive/state event generator should reuse the CFB feature and PBP pipelines, independently validate possession count, scoring event probabilities, NCAA overtime and game/player stat consistency. Do not synthesize made-up drive or personnel inputs.
