# Torvik recovery connection (prepared, not activated)

The 2026–27 season uses ending-year 2027: `2027_team_results.csv` and
`2027_fffinal.csv`, always on `https://barttorvik.com/` with underscores.

`scripts/recover-four-sport-once.mjs` can now call the bounded reader in
`scripts/lib/torvikRecovery.mjs` when `FBIS_TORVIK_RECOVERY_ADMITTED=1` is
explicitly provided. The existing scheduled workflow does not provide it.
Default source budget excludes Torvik; explicit admission adds at most two
requests. This code change is not source-access approval or a verified live feed.

The reader never follows redirects, retries failures or switches hosts. It caps
actual response bytes, validates CSV types, rejects HTML, verifies current team
coverage/identity and metric scales, and requires both ratings and factors.
Receipts contain exact URLs, hashes, HTTP status and retrieval times. Retrieval
is not a verified provider update timestamp, which remains null.

On admitted successful execution, existing private CBB packets gain a separate
Torvik/FBIS-formula comparison. Existing KenPom primary values and all model
coefficients remain unchanged. Four factors are parsed/checked, not additional
model weights. The comparison is not the site's published T-Rank game forecast.
No new R2 object, D1 operation or paid-provider call is added. Existing private
packet writing remains subject to the runner's existing controls. Anonymous
CBB summaries continue to exclude comparisons and raw inputs.

## Remaining operational work

- Establish usable authorized bulk access. The web tool reported the corrected
  ratings URL not accessible via that tool; no successful live check is claimed.
- Admit activation under existing source/budget controls; no workflow has been
  modified to schedule or trigger these requests.
- Verify current private packet publication and authorized private presentation.
  The public board does not consume Torvik comparisons. Do not describe this
  prepared producer as an end-to-end connected board or automatic live feed.
