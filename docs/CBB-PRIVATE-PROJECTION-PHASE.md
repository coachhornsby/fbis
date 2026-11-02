# CBB private projection and public readiness phase

FBIS only. Seven active sports remain unchanged. The frozen CBB-PRO-v1 v1.1.0 rules remain unchanged.

The offline producer joins verified season-2027 inputs with ESPN fixtures using canonical ESPN team IDs. Neutral-site flags are required. It rejects missing teams, stale/future input captures, started games and duplicate identities. The existing KenPom ratings formula generates a private primary forecast; Torvik provides a separate comparison. Neither replaces the independent FBIS native total or missing CBBD confirmation. Prior-season ratings are not substituted.

For the November 2 slate: 182 fixtures, 119 private primary forecasts and Torvik comparisons, 63 fixtures without usable primary inputs, zero current CBBD confirmations, zero native totals, zero qualified plays. Snapshot captured around 04:40 UTC; expires 10:40 UTC November 2. This is a dated preseason research snapshot requiring refreshed verified inputs before further use.

Private HTML and full packet are stored under FBIS_Data/04_Model_Evidence in Drive. Artifacts and provider data must never be committed to the public repository or copied to the public build. The static public serializer uses an explicit allowlist of readiness fields only. Public page views never query D1 or paid AI APIs.

## Publication correction

Successful authentication does not establish public display rights. KenPom API terms (https://kenpom.com/terms-api.php) include derived outputs and require prior written permission for public-facing publication. No such permission has been verified. Private personal analysis is distinct from public release. Do not publish the private scores, margins, totals or raw ratings until permission is verified. This corrects the prior provider inventory's omission of that publication gate.

## Reproduction

`node scripts/build-cbb-projection-packet.mjs <verified-UTC-time>` consumes local verified captures under ignored artifacts. It does not request providers or write databases. Capture paths and slate in this release are explicitly dated; this is not an automated refresh service. Public builds consume only the checked-in sanitized readiness file. Private HTML hides numeric cells after expiry; the JSON is a historical record with explicit expiry, not a live feed.

## Release gates

Refresh verified inputs within the six-hour TTL, obtain current CBBD coverage, build and validate independent native features with sufficient history, and verify source display permission before public numerical release. Markets remain paused; source completion alone does not authorize wagers. No new schedules, subscriptions, provider requests or database writes were introduced by the offline build.

Validation: 17 targeted tests pass (projection packet, frozen CBB-PRO gates, public snapshot isolation). Static production build passes. Temporary operator directories are absent. The build copies only data/public/cbb-readiness into board-data/cbb-readiness.
