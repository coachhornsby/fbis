# NFL FBIS — October 11, 2026, statistical alignment and QB availability audit

**Authority:** READ-ONLY RESEARCH · NOT PRODUCTION PROMOTION · NOT BET-ELIGIBLE

**Inputs:** Current D1 `nfl_team_profile_snapshots` (all 32, observed 2026-10-11T01:50Z), production code as of 523f639e8b36a8e605524ef9d4d6fb7be7ec2a14, source-board copy supplied on 2026-10-11, and official NFL injury observations in D1.

**Evidence limitations:** The uploaded board is a historical *display* copy, not frozen raw feature input for all 13 games. Its spreads/totals are historical observations and should not be treated as executable current prices or closing prices. The current D1 team snapshot is posterior to some earlier pregame freezes, so it is for *statistical alignment only*, not a reconstructed PIT score. No updated economic or prospective claims are made.

## 1. Team efficiency ranking inventory

The live 2026 `identity` records contain roughly four recent team games and an 8-game prior. These values are **prior-shrunk/blended**, not purely unweighted 2026 raw EPA. Net EPA/play = offensive EPA/play − defensive EPA/play allowed; higher is better. Defensive ranks ascend (lower is better). Do not call these fully opponent-adjusted power ratings unless verified separately.

| Team | Current games | Blended net EPA (rank) | Blended offense EPA (rank) | Blended defense EPA allowed (rank) | Pass offense rank | Pass defense rank | Rush offense rank | Rush defense rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| JAX | 4 | +0.161 (#1) | +0.079 (#9) | -0.083 (#3) | #9 | #3 | #7 | #10 |
| LAR | 4 | +0.161 (#2) | +0.098 (#5) | -0.063 (#5) | #5 | #5 | #15 | #12 |
| SEA | 4 | +0.143 (#3) | +0.021 (#14) | -0.122 (#1) | #8 | #2 | #29 | #1 |
| BUF | 4 | +0.122 (#4) | +0.150 (#1) | +0.028 (#20) | #2 | #11 | #2 | #32 |
| NE | 4 | +0.108 (#5) | +0.084 (#7) | -0.024 (#11) | #6 | #10 | #12 | #24 |
| KC | 4 | +0.106 (#6) | +0.072 (#10) | -0.034 (#10) | #12 | #12 | #4 | #8 |
| SF | 4 | +0.088 (#7) | +0.147 (#2) | +0.059 (#25) | #1 | #25 | #10 | #20 |
| CHI | 4 | +0.073 (#8) | +0.080 (#8) | +0.007 (#15) | #10 | #14 | #5 | #28 |
| DEN | 4 | +0.063 (#9) | +0.020 (#15) | -0.043 (#8) | #13 | #4 | #17 | #25 |
| BAL | 4 | +0.062 (#10) | +0.087 (#6) | +0.025 (#19) | #11 | #23 | #3 | #9 |
| DET | 4 | +0.053 (#11) | +0.102 (#4) | +0.049 (#22) | #3 | #24 | #22 | #21 |
| HOU | 4 | +0.045 (#12) | -0.018 (#22) | -0.063 (#6) | #16 | #7 | #28 | #11 |
| PHI | 4 | +0.024 (#13) | -0.016 (#20) | -0.041 (#9) | #19 | #8 | #18 | #19 |
| IND | 4 | +0.015 (#14) | +0.039 (#11) | +0.024 (#18) | #20 | #20 | #1 | #18 |
| ATL | 4 | +0.002 (#15) | -0.017 (#21) | -0.020 (#12) | #25 | #13 | #8 | #7 |
| GB | 4 | +0.002 (#16) | +0.039 (#12) | +0.037 (#21) | #7 | #21 | #31 | #23 |
| MIN | 4 | -0.000 (#17) | -0.120 (#29) | -0.119 (#2) | #31 | #1 | #25 | #3 |
| LAC | 4 | -0.006 (#18) | -0.071 (#27) | -0.065 (#4) | #29 | #9 | #23 | #4 |
| TB | 5 | -0.022 (#19) | -0.037 (#24) | -0.014 (#14) | #28 | #18 | #6 | #2 |
| PIT | 4 | -0.028 (#20) | -0.010 (#18) | +0.019 (#17) | #21 | #17 | #9 | #22 |
| CAR | 4 | -0.045 (#21) | +0.007 (#16) | +0.052 (#24) | #15 | #22 | #24 | #27 |
| NO | 4 | -0.053 (#22) | -0.045 (#25) | +0.008 (#16) | #23 | #19 | #27 | #17 |
| CIN | 4 | -0.054 (#23) | +0.027 (#13) | +0.080 (#29) | #14 | #26 | #13 | #26 |
| NYG | 4 | -0.057 (#24) | -0.006 (#17) | +0.051 (#23) | #17 | #15 | #14 | #31 |
| CLE | 4 | -0.063 (#25) | -0.120 (#30) | -0.057 (#7) | #30 | #6 | #26 | #15 |
| DAL | 5 | -0.064 (#26) | +0.113 (#3) | +0.177 (#32) | #4 | #32 | #11 | #30 |
| ARI | 4 | -0.098 (#27) | -0.023 (#23) | +0.075 (#26) | #22 | #31 | #20 | #6 |
| WAS | 4 | -0.113 (#28) | -0.011 (#19) | +0.102 (#31) | #18 | #27 | #16 | #29 |
| MIA | 4 | -0.124 (#29) | -0.046 (#26) | +0.078 (#27) | #24 | #28 | #19 | #14 |
| LV | 4 | -0.131 (#30) | -0.149 (#32) | -0.018 (#13) | #26 | #16 | #32 | #5 |
| NYJ | 4 | -0.167 (#31) | -0.085 (#28) | +0.083 (#30) | #27 | #30 | #30 | #16 |
| TEN | 4 | -0.207 (#32) | -0.129 (#31) | +0.078 (#28) | #32 | #29 | #21 | #13 |

**Source features:** `functions/lib/nflVerseFeed.js` separately blends current with prior using an 8-game team prior and 4-game player prior. `functions/lib/nflProModel.js` consumes team off/def EPA, success rates, early-down EPA, QB EPA/CPOE/NGS, pass/rush matchup efficiency, pressure/trenches, NGS, special teams, rest/travel and home field when available. Use strict feature-specific coverage diagnostics rather than extrapolating from these rankings.

## 2. 13-game board scoring comparison

**Column conventions:** FBIS score is away–home; model margin is home minus away; spread gap is FBIS home margin minus market-implied home margin (positive means FBIS favors home more than quoted spread); total gap is FBIS projected total minus quoted historical market total. The quoted market spread comes from the user-provided board, *not today's executable quotes*. Net ranks are separate contemporaneous blended efficiency rankings, not input-by-input score reconciliations.

| Game | FBIS away–home | FBIS home margin | Board market favorite | Home spread disagreement | FBIS total | Board market total | Total disagreement | Blended net EPA ranks away/home |
|---|---:|---:|---|---:|---:|---:|---:|---|
| CIN @ MIA | 20.7–20.7 | 0.0 | CIN -7 | +7.0 | 41.4 | 43.5 | -2.1 | #23 / #29 |
| DET @ ARI | 23.0–21.7 | -1.3 | DET -5.5 | +4.2 | 44.7 | 54.5 | -9.8 | #11 / #27 |
| HOU @ TEN | 20.9–20.4 | -0.5 | HOU -7 | +6.5 | 41.3 | 37.5 | +3.8 | #12 / #32 |
| PHI @ JAX | 23.5–25.7 | +2.2 | JAX -7.5 | -5.3 | 49.2 | 42.5 | +6.7 | #13 / #1 |
| MIN @ NO | 19.7–23.7 | +4.0 | MIN -1.5 | +5.5 | 43.4 | 41.5 | +1.9 | #17 / #22 |
| SF @ SEA | 26.8–24.8 | -2.0 | SEA -3 | -5.0 | 51.6 | 46.5 | +5.1 | #7 / #3 |
| BAL @ ATL | 24.3–22.6 | -1.7 | ATL -3 | -4.7 | 46.9 | 43.5 | +3.4 | #10 / #15 |
| LV @ NE | 19.1–26.0 | +6.9 | NE -3.5 | +3.4 | 45.1 | 45.5 | -0.4 | #30 / #5 |
| DEN @ LAC | 23.3–22.6 | -0.7 | DEN -3.5 | +2.8 | 45.9 | 41.5 | +4.4 | #9 / #18 |
| CHI @ GB | 23.4–24.3 | +0.9 | CHI -1.5 | +2.4 | 47.7 | 47.5 | +0.2 | #8 / #16 |
| IND @ PIT | 22.1–22.9 | +0.8 | PIT -3 | -2.2 | 45.0 | 42.5 | +2.5 | #14 / #20 |
| NYG @ WAS | 19.8–21.6 | +1.8 | WAS -3.5 | -1.7 | 41.4 | 41.5 | -0.1 | #24 / #28 |
| CLE @ NYJ | 16.8–19.8 | +3.0 | NYJ -2.5 | +0.5 | 36.6 | 38.5 | -1.9 | #25 / #31 |

Largest total disagreement in this board: DET@ARI -9.8; PHI@JAX +6.7; SF@SEA +5.1; DEN@LAC +4.4.

Largest spreads that require decomposition: CIN@MIA favors MIA +7.0 relative to historical market; HOU@TEN favors TEN +6.5; MIN@NO favors NO +5.5; PHI@JAX favors PHI +5.3; SF@SEA favors SF +5.0; BAL@ATL favors BAL +4.7.

**No reconstructed score has been certified as component-reconciled.** The exact historical `nflFeatures.home/away` fields, per-game component decomposition, versioned publication hashes, and state timestamps at each freeze are required for that. D1 `published_projections` held only one 2026-10-11 NFL `v1.2` record during this audit, for event 401872981 (PHI@JAX), so exact 13/13 frozen-model decomposition is not currently verifiable from that table. Current values must not be substituted as historical PIT inputs.

## 3. Specific high-value discrepancies

- **DET@ARI totals:** Detroit off EPA #4/pass EPA #3 against Arizona pass defense #31, while Detroit defense #22. Model 44.7 vs board 54.5: gap -9.8. Pace/possessions, environment, NGS and defensive efficiency need exact component accounting before claiming calibration error.
- **HOU@TEN margin:** Houston net #12/defense #6 versus Tennessee net #32/offense #31/pass offense #32. Model Houston +0.5 vs historical market -7: 6.5-point disagreement in Tennessee's direction. Check score compression, QB, weighting and missing-feature behavior.
- **MIN@NO:** Minnesota pass defense #1 and overall defense #2; the board projects NO +4.0. Check team/QB components, venue and offense-specific matchups.
- **SF@SEA:** San Francisco passing offense #1 confronts Seattle defense #1/pass defense #2/rush defense #1. Model total 51.6 vs 46.5. Separate QB and pass-EPA overlap in diagnostic ablation.
- **CIN@MIA:** Model tie despite CIN net #23 vs MIA #29. Check offense/defense component cancellation.
- **PHI@JAX:** JAX blended net EPA #1 vs PHI #13, but JAX only +2.2 in board. Reconcile expected possessions, QB, and international neutral-site HFA. Do not use later final/live data.

## 4. Current score-input authority

Verified runtime call order in `functions/lib/slateEngine.js`:
`attachNflShadow → attachNflVerseFeatures → attachNflProShadow → attachNflGameMatchups → promoteNflResearchToBoard → attachNflPlayerProjectionResearch → attachNflPersistentProfiles`.

Thus:
- NFL-PRO-v1.2 research score consumes **archived NFLverse/NGS game feature data**; it does not consume the later-attached `nflPersistentProfile`.
- `nflGameMatchup` computes an overlay but board promotion uses the *original* `nflProShadow` score. Four directional unit adjustments are marked `research-display-only`; the UI term “MODEL ADJUSTMENT” is potentially misleading.
- Persistent NFL injury state is attached to game context *after* the displayed score is computed and cannot retroactively change it.
- Core off EPA includes quarterback contribution while the separate QB index is added, so potential QB feature collinearity/double-counting should be tested by an independent ablation. Do not assert it is proven without an OOS test.
- `functions/lib/nflProV2Model.js` contains an availability interaction as a separate shadow, not the v1.2 displayed score; do not assume it was active.
- `functions/lib/proPlayerProjectionLayer.js` uses last-five/current/prior blends and separate role, snap-volume, NGS and opponent-defense factors for NFL props. It is not a universally calibrated identity of opportunity × efficiency, and may select a historical QB1 based on last-five usage independent of today's official starter. Verified QB1 OUT must block any representation of that player as an actionable projection.

## 5. Ravens–Falcons official injury linkage

- Official Baltimore report and NFL report (dated Friday Oct 9) identify **Lamar Jackson OUT (ankle)**; **Tyler Huntley starting**. Also Trey Hendrickson and Cam Jurgens out, Zay Flowers and Marlon Humphrey questionable.
- D1 `player_availability_observations` contains Jackson OUT observations starting Oct 9; latest checked 2026-10-11T15:54:51.949Z.
- D1 `nfl_player_profiles` contains `Lamar Jackson | QB1 | OUT | source nfl-official` and `Tyler Huntley | QB2 | AVAILABLE`, with available replacement metadata.
- D1 `nfl_team_profiles` aggregates were last refreshed 2026-10-11T01:50Z, before later official ingestion; team-level counts may be stale even while individual player state is fresh.
- Last available event 401872993 QB prospective shadow: 2026-10-09T01:14:47.265Z, `EARLY`, QB burden 0.252323 (`DNP_PRACTICE`), gate 0.30 not fired, challenger == incumbent, no injury correction. The frozen row must remain immutable.
- The LATE window for 2026-10-12T00:20Z kickoff begins 2026-10-11T20:20Z (3:20 p.m. Chicago) and ends 15 minutes before kickoff. A natural on-schedule capture may calculate the OUT burden using fresh data. Do not retroactively claim the earlier row reflected confirmed OUT.
- **No production champion or v1.2 research score changed for Jackson's absence.** The new QB availability strip is diagnostic only. No invented expected point swing, confidence or bet.

## 6. Predictive validation

The repository's existing `docs/nfl-pro-v1-1-validation.md` documents an **archived**, not freshly re-run, chronological paired sample of 2,176 regular-season games (2018–2026 at time of the prior validation):

| Metric | NFL-PRO-v1.1 | Calibrated form baseline | Closing market benchmark |
|---|---:|---:|---:|
| Margin MAE | 10.1993 | 10.3549 | 9.8543 |
| Total MAE | 10.6774 | 11.1791 | 10.4035 |
| Winner accuracy | 64.338% | 63.649% | 66.406% |

These numbers support improvement over form baseline in that historical study, **not** superiority over the closing market, v1.2 eligibility or wagering authority. Independently reproduce fold-level results and uncertainty before using for promotion.

New v1.2 shadow grading, market CLV, ATS, calibrated EV and the requested feature-by-feature ablations remain pending reliable versioned historical PIT feature snapshots and completed outcomes. Missing evidence is not proof of zero error.

## 7. Research roadmap and no-change governance

1. **Operational:** Verify today's next authorized NFL QB SHADOW LATE capture for BAL@ATL and display official QB1 absence on game cards; never mutate the frozen EARLY evidence or production score.
2. **Observability:** Freeze **per-score decomposition** (teamPower, pass/rush, QB, NGS tracking, special teams, context, neutral HFA, feature coverage, code SHA) with exact incoming feature timestamps and score checksums. Separate the user-facing four directional diagnostics from true scoring contributions.
3. **Historical:** Build an immutable compact v1.2 feature table from nflverse/NGS by historic as-of date, report sample sizes and missingness; do not backfill current injury reports as historical knowledge.
4. **Ablation:** Independently test QB contribution versus team offense EPA, NGS, personnel, success, special teams and matchup variants using time-separated folds.
5. **Player props:** Study opportunity-volume errors (attempts/carries/targets), starter selection and injury suppression before comparing efficiency. Free PrizePicks mirror remains research-only.
6. **Economic:** Once valid frozen odds and prospective outputs exist, compare against closing lines, no-vig baselines, ATS, totals, CLV and simulated unit returns without authorizing wagers.
7. **Promotion:** Existing v1.1 production champion identity, 0.30 QB gate, star ceilings and all qualification/wager authority remain unchanged until independent tests and explicit operator approval.

**Build conclusion:** source injury ingestion healthy, player-level status current, displayed NFL-PRO-v1.2 score not injury-aware, QB overlay EARLY freeze pre-OUT, late freeze pending; team raw-stat/score alignment mismatches require exact PIT decomposition. Do not report a scientific-completion percentage.