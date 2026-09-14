# Market Roles

FBIS separates market data into explicit roles. Pinnacle is never synonymous with “the market.”

## Hierarchy

1. **FBIS PURE** — independent projection (upstream of all markets)
2. **EXECUTION_MARKET** — books the operator can actually wager (Heritage by default; configurable via `operatorExecutionBooks`)
3. **CONSENSUS / MARKET_INTELLIGENCE** — ACTION + soft multi-book context (movement, public splits as public positioning, disagreement)
4. **REFERENCE_MARKET** — optional research benchmark (Pinnacle)

## Availability

```
marketAvailable = execution available OR consensus available
```

`referenceMarketAvailable` is independent. Missing Pinnacle must not block board display, publication, or model disagreement.

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
