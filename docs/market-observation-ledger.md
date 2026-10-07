# Normalized Market Observation Ledger

The append-only `normalized_market_observations` table stores venue observations without changing model truth. `normalized_market_decision_links` freezes which observation was used at a decision timestamp. `normalized_market_economic_grades` links entry and close observations to result/profit/CLV evidence.

Snapshot lifecycle is explicit: OPEN, DECISION, CURRENT, CLOSE, RESULT. A row is never updated into another lifecycle state; later states are new observations or grade records.

Venue identity is retained. DraftKings, Heritage, PrizePicks and Underdog must remain separate sources. Pick'em thresholds must not receive fabricated sportsbook odds. Conventional sportsbook observations may carry American/decimal prices and no-vig probabilities.

DraftKings Predictions UI percentages are not sportsbook odds. If ingested, they must use a prediction/reference source type and a dedicated probability field in a future additive schema extension; they must never be interpreted as American odds, sportsbook implied probability, or executable price.

Tennis is the first board consumer. Its board API reads latest observations per source/market/threshold and exposes `market.venueOffers`; the Tennis card renders a multi-venue table while the independent Tennis-FBIS projection remains unchanged.

The generic GameCard can render `market.venueOffers` for ML/spread/total once each sport's collection path populates the ledger.

Economic validation requires an immutable ENTRY/DECISION observation, a later CLOSE observation from the same venue/market expression, and a settled result. CLV must be calculated from comparable price/probability states; threshold changes are retained rather than collapsed.
