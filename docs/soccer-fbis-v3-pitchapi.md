# SOCCER-FBIS-v3 — PitchAPI Advanced Challenger

## Status
- Model: `SOCCER-FBIS-v3`
- Version: `research-v1-pitchapi-advanced`
- Role: research shadow challenger behind validated research incumbent `SOCCER-FBIS-v2`
- Market data in projection: prohibited
- Wager authority: disabled

## Source
PitchAPI supplies independent football observations. FBIS uses its API through a server-side `PITCHAPI_API_KEY`. Provider ids and raw responses are preserved.

## Feature families
- Shot quality: xG, xGOT, shots, shots on target, big chances
- Pressing: PPDA, high turnovers, counterpress regains, ball-recovery time
- Territory: field tilt, final-third entries, box entries, possession
- Possession value: xT and VAEP
- Progression/creation: progressive passes, progressive carries, xAG
- Tempo: passes per sequence and direct speed
- Player impact: per-match xT, VAEP, xAG, xG-chain, xG-buildup and minutes
- Lineups: predicted/confirmed lineup snapshots observed before kickoff

## Temporal integrity
Post-match target features are used only to update state after the match result. Historical actual lineups fetched after a match are marked `post_match=1` and never qualify as pre-kick lineup evidence. Prospective lineup observations are eligible only when `observed_at < kickoff_time`.

## Model
V3 trains an online multinomial H/D/A challenger chronologically from rolling team advanced-feature state. It then blends that independent probability vector with SOCCER-FBIS-v2. The blend remains research-only until walk-forward validation proves v3 improves probability quality.

## Runtime / timeout policy
- PitchAPI requests: 10-second hard request timeout
- retries: maximum 3, honoring bounded Retry-After handling
- historical ingestion: maximum 80 matches per shard
- default concurrency: 3
- API persistence chunks: maximum 10 bundles
- GitHub sync job: 12-minute timeout
- live sync: seven leagues, max parallel 3
- no unbounded loops or provider polling

## Ingestion
`.github/workflows/soccer-pitchapi-v3-sync.yml`

Scheduled live mode captures recent finals plus nearby upcoming fixtures so predicted/confirmed lineup observations can be persisted prospectively. Manual historical mode takes a league, season, offset and bounded match count so the 2021-present history can be backfilled in restartable shards.

## Promotion gates
1. PitchAPI historical coverage established.
2. True point-in-time v3 walk-forward against v2.
3. Feature-family ablation / coverage review.
4. League-specific calibration review.
5. Frozen no-vig market replay / benchmark.
6. Prospective lineup and player-impact shadow evidence.
7. Star calibration re-run.
8. Only then can promotion be considered.

The v2 research projection remains the board authority until these gates pass.
