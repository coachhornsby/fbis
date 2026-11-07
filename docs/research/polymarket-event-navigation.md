# Polymarket US event navigation

The official Texas–Missouri game destination was verified on November 7, 2026:
https://polymarket.us/sports/cfb/cfb-tx-missr-2026-11-07

This proves that specific game destination, not a generic URL construction rule or selected-contract deep link. No game URL is constructed from a ticker, title, team abbreviation or market slug.

The optional navigation pipeline accepts an explicit provider event `eventUrl` or `url` only when it is an HTTPS polymarket.us sports URL whose sport and final path segment exactly equal the captured sport and event slug. The event ID, canonical game ID and kickoff travel with that URL and are revalidated through the bounded roster and card presentation. Unknown, conflicting, malformed, closed and invalid records never gain links. Event links are labeled “View game on Polymarket US,” not selected-contract destinations. Existing exact-market links remain separate.

Source metadata is passed through normalization, existing capture/bootstrap candidate construction, stored-observation roster reconstruction, bounded roster validation, snapshot selection and card delivery. No requests, schedule changes, extra read/write operations, budget changes or freshness relaxation are introduced. Payloads with navigation metadata are slightly larger and remain subject to existing byte ceilings.

## Unresolved source requirement

The official event API documentation (https://docs.polymarket.us/api-reference/events/get-event-by-slug) documents event IDs, event slugs and constituent markets. It does not document a website event URL field. The optional `eventUrl`/`url` ingestion is defensive forward compatibility, not evidence that production responses contain either field. Existing snapshots cannot be retroactively given links by this change. Tests explicitly use synthetic provider IDs/responses alongside the independently verified website URL.

To populate game links generally, obtain explicit website URLs tied to provider event IDs from an authorized source (for example a supported provider field or verified navigation export), then preserve them in existing capture records. Alternatively, obtain an authoritative documented generic website-route contract before adding URL construction. Do not infer one from the single observed game page. No extra source discovery or collector activation is included here.
