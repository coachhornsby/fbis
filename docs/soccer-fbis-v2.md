# SOCCER-FBIS-v2

## Status

- Model ID: `SOCCER-FBIS-v2`
- Version: `research-v1-elo-context-online-ensemble`
- Maturity: RESEARCH
- Independent projection: yes
- Market-informed projection: no
- Can qualify wagers: no
- Can authorize wagers: no

## Purpose

SOCCER-FBIS-v2 extends the v1 Dixon-Coles structural score model with a second,
independent pre-match outcome model. The objective is to add information that a
goals-only Poisson model does not carry while preserving strict point-in-time
integrity.

The implementation was informed by public soccer-analytics patterns observed in
the MIT-licensed Atlastra project, but FBIS does not import Atlastra data,
credentials, warehouses, trained artifacts, or provider access. Data-source
rights are evaluated independently from source-code licensing.

## Projection architecture

### Component A — structural score model

SOCCER-FBIS-v1 remains intact inside v2:

- recency-weighted attack and defense rates
- home/away splits
- shrinkage toward league scoring environment
- Dixon-Coles low-score correction
- score matrix
- 1X2
- totals
- BTTS
- Asian handicap surfaces

### Component B — causal outcome challenger

The challenger is an online multinomial classifier. For every historical match:

1. Build features only from matches already completed before kickoff.
2. Produce the pre-match H/D/A probability vector.
3. Observe the result.
4. Update classifier weights.
5. Update Elo and team state.

The current feature set is:

- Elo differential with a home-field offset
- season-to-date points per match
- season-to-date goals for/against
- last-five PPG/GF/GA
- venue-specific PPG/GF/GA
- rest-day differential
- shots-on-target differential when available
- possession differential when available
- xG/xGA differential when available
- PPDA differential when available
- deep-completion differential when available
- expected-points differential when available

Missing optional fields are represented as unavailable evidence; they are not
imputed from market prices or fabricated.

### Component C — ensemble

The final 1X2 vector blends v1 and the challenger.

The v1 weight is adaptive and bounded. It rises when history is sparse or the
challenger has few updates. It can decline modestly when advanced independent
features have strong coverage.

The v1 score lambdas still drive score-derived markets (totals, BTTS and Asian
handicap) until a separate v2 score-distribution challenger is validated.

## Data architecture

Canonical storage remains `soccer_matches`.

Migration `0052_soccer_v2_features` adds nullable fields:

- home_xg / away_xg
- home_ppda / away_ppda
- home_deep_completions / away_deep_completions
- home_expected_points / away_expected_points
- advanced_source
- advanced_observed_at

Existing fields already support shots, shots on target, possession and corners.

The incremental ingest may query ESPN match summaries with a bounded fan-out.
Bootstrap ingestion does not perform advanced-summary fan-out.

## Timeout policy

The advanced incremental path is deliberately bounded:

- at most 12 summary enrichments per league/process
- 4.5-second request timeout
- no unbounded provider wait
- bootstrap advanced enrichment disabled
- canonical upserts are idempotent

The walk-forward workflow has an 18-minute job limit and each ESPN history
request inherits the bounded request/retry behavior used by the v1 validator.

## Validation

The required historical gate compares v2 and v1 on identical true expanding
walk-forward matches.

Historical evidence passes only when:

- sample >= 1,000 matches
- v2 Brier < v1 Brier
- v2 log loss < v1 log loss
- v2 1X2 accuracy is no more than 0.25 percentage points below v1

A historical pass does not grant wager authority.

Subsequent gates remain:

1. no-vig market benchmark
2. edge-bucket stability
3. league-specific review
4. prospective shadow validation
5. star monotonicity revalidation
6. operator promotion decision
7. separate staking validation

## Source policy

The projection layer must stay market-free.

Permitted model inputs must be independently sourced football observations with
documented provenance. An open-source repository license does not automatically
grant FBIS rights to upstream provider data used by that repository.

Accordingly, optional advanced features are provider-neutral in the model and
nullable in D1. A source may populate them only after the source is approved for
the intended FBIS use.

## Confidence stars

The UI can continue to display the common FBIS 1–5 star format during research.
Stars indicate projection confidence, not authorization to place a wager.

After the v2 walk-forward completes, the star buckets must be checked again for
monotonicity before any v2-specific confidence policy is frozen.
