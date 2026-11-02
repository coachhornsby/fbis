# FBIS CBB private market and identity intake

The November 2 Grok archives now pass independent byte/hash verification. An offline producer stages research observations and identity leads without changing the frozen model or public publication build. These morning snapshots are historical research, not current executable prices.

## Delivered

- `scripts/cbb-research-intake.py` verifies the pinned archive hashes, rejects unsafe archive members and verifies complete internal hash-manifest coverage when supplied. It reads archives in memory and never executes archived Python or contacts providers.
- The market archive has 29 files: 28 hashed content members plus its manifest. The two-file identity archive has no internal manifest; its complete archive SHA-256 is verified and derived outputs receive a new manifest.
- 2,697 Kalshi observations retain source files, capture times, contract identifiers, price units, available raw sizes, rules and pagination state. They comprise 2,502 original raw markets and 195 later early-game observations. Repeated contracts at different times remain separate observations.
- 257 observations bind to four frozen ESPN fixtures through explicitly reviewed provider event codes and exact frozen date/team/neutral-site identity checks. The other 2,440 remain unbound; no broad fuzzy matching or automatic slate promotion.
- All 63 ambiguous player records are independently recomputed against the saved current roster and historical Torvik data. Twenty same-team leads and 43 unresolved records remain unverified. No player-impact adjustment, availability assumption or cross-provider ID promotion.
- Heritage American odds and Polymarket US ask-style transcripts remain private source evidence, not an invented structured orderbook. International Gamma files remain separate from Polymarket US. Public display, model-adjustment authority and wager authority are false throughout.

## Time and completeness limits

The raw Kalshi capture is producer-reported at 01:08 CST / 07:08 UTC. The early CSV has its own approximately 01:14 CST timestamps and no order sizes. Only 62 early contracts appear in the earlier raw data. Earlier sizes are never attached to later quotes. A volume field or a ladder near 50% does not prove executable liquidity or create a sportsbook line.

The spread and total raw responses each contain 1,000 markets and an outstanding cursor, so they are incomplete. GAME (412) and TEAMTOTAL (90) have no returned cursor; that establishes completion of the captured query response, not coverage of every CBB market/date. Early per-event pagination completion is producer-reported; raw page chains were not supplied and are not independently certified. All staged quotes are marked historical and unavailable for execution. Capture timestamps are producer evidence, not independent server receipts.

Existing West Florida classification, Ryan Conway 22-versus-23 games, Saint Francis historical mapping and availability gaps remain unchanged. No projection regeneration, new provider pull, D1 operation, collector restart, credential change or production deployment.

## Reproduction and private outputs

From the repository root, place the original pinned `markets.tar.gz` and `identities.tar.gz` in `artifacts/cbb-research-intake/`. Keep the prior verified files in `artifacts/cbb-grok-integration/staged/` and frozen ESPN packet in `artifacts/cbb-projection-phase/private-projections.json`.

Run `PYTHONDONTWRITEBYTECODE=1 python scripts/cbb-research-intake.py`.

Outputs in the ignored private `artifacts/cbb-research-intake/staged/` directory:

| File | Use |
| --- | --- |
| kalshi-observations.json | Historical contract/rule/quote research with source-specific timestamps |
| identity-research.json | Full 63-record lead queue, exact historical candidates and unchanged unknown availability |
| venue-coverage.json | Venue/product boundaries and capture limitations |
| receipt.json | Counts, archive verification and unresolved limitations |
| manifest.json | Derived-output sizes and SHA-256 hashes |

Validation: seven focused Python tests cover corrupt manifests, missing hash coverage, archive traversal, wrong archive hashes, quote validity, timestamp/size separation, identity binding and frozen fixture drift. Prior CBB staging/projection/fixture checks are also run before delivery.

## Next Grok assignment

Prioritize current official availability and starting-lineup evidence for the remaining unstarted November 2 CBB games, with event/player/team IDs, source URL and original publication/retrieval time. Do not treat missing injury news as a healthy-player confirmation. Research the 20 same-team identity leads using official bios before spending effort on the 43 unresolved names. Keep all unconfirmed records unknown.

Do not re-pull the entire early slate to repair an old snapshot: it cannot recover its historical orderbook. If raw page chains from the original early pull still exist, deliver those existing files. A later permitted capture must be a separately timestamped dataset with complete cursors and actual same-time sizes/rules, never a replacement for historical data. This assignment authorizes research only; wager execution remains outside ChatGPT/Codex integration.
