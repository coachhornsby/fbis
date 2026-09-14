# Market Roles

FBIS separates market data into explicit roles. Pinnacle is never synonymous with “the market.”

## Hierarchy

1. **FBIS PURE** — independent projection (upstream of all markets)
2. **EXECUTION_MARKET** — books the operator has **explicitly configured** via `operatorExecutionBooks` (default: none). Heritage is a supported execution provider but is **not** assumed as the operator book.
3. **CONSENSUS / MARKET_INTELLIGENCE / OBSERVED** — ACTION + soft multi-book context (movement, public splits as public positioning, disagreement). Unconfigured sportsbook observations land here — never as fabricated execution.
4. **REFERENCE_MARKET** — optional research benchmark (Pinnacle)

## Availability

```
marketAvailable          = execution available OR consensus/observed available
executionMarketAvailable = at least one configured operator book has a usable quote
referenceMarketAvailable = independent (Pinnacle); never required for board/ops
```

Missing Pinnacle must not block board display, publication, or model disagreement.

Missing configured execution books:

- `executionMarketAvailable = false`
- Heritage (or any provider) data alone does **not** become EXECUTION_MARKET
- Research / MODEL vs MARKET comparison may still use consensus
- Consensus cannot create executable price, EV on an assumed book, qualify, authorize, or enter YOUR BET

## Freshness (role-aware)

| Role | Default max age | Notes |
|------|-----------------|-------|
| EXECUTION | 45 minutes | Strict. Stale execution may remain visible but is **not actionable**. |
| CONSENSUS / OBSERVED / INTELLIGENCE | 3 hours | Moderate |
| REFERENCE | 12 hours | Research-oriented / looser |

Constants live in `MARKET_FRESHNESS_MS` (`functions/lib/canonical/marketRoles.js`). Tune via config later; do not invent silent production thresholds elsewhere.

## Offer selection (honest semantics)

Line + price stay coupled. Until full offer valuation exists:

- **BEST EXECUTION** — only when comparing like-for-like line/selection (same market + same point) under American-odds preference
- Otherwise label **AVAILABLE OFFER** / **EXECUTION OFFER** — never imply `+3 -120` is objectively better than `+2.5 -105` without valuation

## Quality

Quality is componentized:

- model input quality
- execution market quality
- market intelligence quality
- reference market quality
- event identity quality

Legacy flags such as `incomplete_pin_ml` normalize to `reference_market_incomplete_*` and do not dominate operational score.

## Compatibility

Historical `PINNACLE_IMPLIED` rows remain readable as market-derived benchmarks. New writes use role semantics. Pinnacle ingestion is retained as a demoted reference pipeline.
