"""Fixed, verified retrospective CFB roster archive retention contract.

Historical 2004 observations were independently restored with zero field mismatches
across all 13,644 rows and 27 columns. Live roster *membership* and identity ledgers
are not archived by this policy and must retain their standard ingestion.

No automatic release of archived raw observations. Updating season 2004 historical
sources requires a separately verified new immutable R2 capture and amendment.
"""

CFB_ROSTER_COLD_ARCHIVE_FULL_MANIFEST = (
    "research/storage-recovery/cfb-roster-cold-pilot/2004/"
    "full-season-manifest-675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json"
)
RELEASED_RETROSPECTIVE_ROSTER_OBSERVATION_SEASONS = frozenset({2004})


def persist_d1_raw_roster_observation(season: int) -> bool:
    """Only the exact proven historical source season is cold-storage-only.

    All other seasons retain the original observation-writing behavior. Caller
    continues to write canonical players, aliases, memberships and their PIT.
    """
    if isinstance(season, bool) or not isinstance(season, int):
        raise ValueError("CFB roster season must be an integer")
    if season < 2004 or season > 2026:
        raise ValueError("CFB roster season out of configured source scope")
    return season not in RELEASED_RETROSPECTIVE_ROSTER_OBSERVATION_SEASONS
