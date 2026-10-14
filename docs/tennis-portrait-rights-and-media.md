# FBIS Tennis portrait registry — rights-gated

## Purpose
The approved Tennis matchup UI already has head-and-shoulders portraits over country-flag backgrounds. `tennis_player_portraits` is the authoritative **media-rights and asset delivery** registry tied to `tennis_players.fbis_player_id`; it is separate from rankings, stats, event identity, and prediction authority.

FBIS is publicly viewable during development. A personal-use intention **does not establish public display rights** for ATP/WTA photography. Do not scrape or hotlink ATP/WTA portraits without explicit permission. This feature does not fetch those sites and stores **zero photographs** until an eligible image is supplied.

## Controlled addition of an authorized image

1. Confirm the exact canonical player ID exists in `tennis_players` (for example, `tennis:wta:12345`); never join portraits on display names or replace a missing portrait with another player.
2. Obtain an image with documented authorization allowing **public web display** in the FBIS context, including applicable wagering-context restrictions. Record the source and the rights proof reference; store that proof securely, **not as a public file or secret**.
3. Prepare PNG, JPG, or WebP media containing the correct player. Crop for head-and-shoulders presentation, preserving any required credits; do not manipulate the image beyond permitted rights.
4. Upload to the existing Cloudflare `ARCHIVE` R2 bucket under `tennis/portraits/{canonical_player_id}/{filename}.{webp|png|jpg}` with the correct `contentType`.
5. Add or update a record in `tennis_player_portraits`: `asset_key`, `content_type`, `source_name`, `source_reference`, `attribution_text`, `display_scope`, `approval_status`, `public_display_allowed`, `rights_evidence_ref`, `approved_at`, `expires_at` and reviewer metadata.
6. Default to `PENDING`, `PRIVATE_ONLY` and `public_display_allowed=0`. Only mark `APPROVED`, `PUBLIC_WEB` and `public_display_allowed=1` after verifying public display permission. For future private-only access, add explicit auth before enabling any private image route; this endpoint intentionally **does not** serve private assets.
7. Verify `GET /api/tennis-portrait?id={canonical_player_id}` returns the correct mime type and a short cache lifetime, and that the board and `/api/tennis-player-profile?id={canonical_player_id}` render the identical image. Check normal, missing, expired, revoked and neutral-athlete displays.

### Image revocation
Revoke by setting `approval_status='REVOKED'` or `public_display_allowed=0` immediately and remove the R2 object when appropriate. This endpoint caches for at most 120 seconds; also purge affected edge caches when time-critical.

### Safety and correctness
- No direct remote image URL or discovered ATP/WTA image URL can authorize a photo. Legacy `tennis_players.official_headshot_url` and `tennis_player_bank.headshot_url` are deliberately not displayed.
- Registry lookup is keyed on exact `fbis_player_id`, with strict path ownership and mime matching; SVG, arbitrary URLs, and data URLs are rejected.
- Public reads must have nonempty rights evidence, an approval timestamp, `PUBLIC_WEB` scope, explicit public permission, a matching R2 path and a non-expired rights window.
- Missing database migration, missing R2 assets, identity mismatches, bad or expired rights fall back to the approved no-portrait display.
- Face image licensing and betting decisions are independent: this change never modifies projections, market edges or wagering authority.

## Deployment
Apply migration `0102_tennis_player_portrait_rights.sql` using the repository's established forward-only D1 migration process before inserting images. Do not bypass migration reconciliation. The read path tolerates a not-yet-applied migration by withholding all portraits.

Validate `npm test`, `npm run test:tennis`, `npm run verify:migrations` and `npm run build`, plus live UI checks before deployment. Verify that existing Tennis cards stay responsive on desktop and mobile with zero image rows.
