# FBIS FBS Team Profiles — read-only identity surface

## Scope
`/?route=teams` (optional `&team=cfb:espn:333`) is a **FBS-only** team profile page backed by existing `cfb_canonical_teams` D1 rows. It does not invoke ESPN, CFBD, SportsDataverse, Open-Meteo, sportsbook services or customer-slate refresh paths. API: `GET /api/cfb-teams` and `GET /api/cfb-teams?team=cfb:espn:<id>`.

At the audited 2026-10-10 D1 cutoff, 901 canonical college teams include **138 active FBS teams**. All 138 have stored coordinates, source colors and ESPN logo URLs. Do not substitute FCS/UNKNOWN/inactive teams to fill the list.

## Branding and geographic accuracy
The canonical `source_json` is a SportsDataverse ESPN-derived team dataset with CFBD enrichment. The profile presents source-reported `color`, `alternate_color`, ESPN CDN `team_logo`, nickname/`mascot`, venue name, capacity, surface, latitude/longitude, elevation and time zone.

**These are not independently confirmed university-official brand values.** The source's `mascot` is ordinarily the athletic nickname (e.g. Crimson Tide), not necessarily the name of the costumed mascot character (e.g. Big Al). Do not fabricate the missing character. The mapping is explicitly `officialVerified:false` until school-primary-source verification.

Venue latitude/longitude come from the stored provider observation. Preserve the original precision but do not assert the result is a surveyed field-center or exact street address. The map link uses source coordinates. For school-official accuracy a later **separately reviewed source-verification phase** should preserve the school/athletics/stadium URL, observation time, the verified property and reviewer. No unverified overriding of canonical IDs or studio logos.

## Statistical state
The page attempts a **read-only** lookup of the most recent `team_feature_snapshots` row. Production currently lacks this table, so the correct display state is `PERSISTENCE_UNAVAILABLE`; no zero-filled ratings, invented advanced statistics or reconstructed historical pregame features are shown. `team_form` is a separate stale legacy signal and is labelled accordingly, never presented as current model authority.

Existing draft PR #927 proposes recovery of missing college tables as migration 0098. This page intentionally does not merge, embed or apply it. Data recovery, persistent incremental game observations, point-in-time state versioning and projection reader routing are **separate release gates**. Even after migration, empty tables do not confer populated state.

## Boundaries
- Zero external provider acquisitions on Team Pages reads.
- Read-only D1 queries; no D1 mutations or migrations.
- Explicit FBS eligibility in SQL and mapper; 400 invalid ID and 404 for FCS/unmatched IDs.
- Research-only team state, `canInfluenceProjection=false`, `canQualify=false`, `canAuthorizeWager=false`.
- No fitted `CFB-FBIS-v2` mathematics, wagering authority or downstream Board change.
- Keep probability-integrity PR #936, player-prop PR #937, and persistence PR #927 independently reviewed.

## Independent release acceptance
Verify all 138 active FBS records appear in directory; FCS/UNKNOWN cannot be accessed by name or direct ID; mobile list, conference filter, team deep-link, responsive logo and colors work; no untrusted logo URL; stadium map pin corresponds to stored coordinates; mascot character is marked unsourced; source-verification warning visible; D1 missing table displays a useful unavailable state; non-Team routes and direct `?route=teams` do not trigger an accidental CFB paid-provider refresh.

Team Pages navigation and Board/Model model-authority state must be reviewed separately. No deployment without operator approval.
