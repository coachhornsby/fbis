# Torvik bounded recovery connection

The 2026–27 season uses ending-year 2027: `2027_team_results.csv` and
`2027_fffinal.csv`, always on `https://barttorvik.com/` with underscores.

`scripts/recover-four-sport-once.mjs` can now call the bounded reader in
`scripts/lib/torvikRecovery.mjs` when `FBIS_TORVIK_RECOVERY_ADMITTED=1` is
explicitly provided. The existing once-daily workflow permits admission only on
the scheduled run’s first attempt; pushes, manual runs and reruns do not collect
Torvik. Default source budget excludes Torvik; admission permits the existing
two-request ceiling. Deployment alone is not a verified automatic live feed.

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

- Verify both exact bulk-file receipts in the intended production runner. A
  successful standalone source check does not establish scheduled collection or
  owner-only packet publication.
- Confirm remaining daily source allowance before activation. Diagnostic
  source requests and scheduled captures must not be silently counted in
  separate daily allowances. Verify the first eligible scheduled run’s receipts.
- Verify current private packet publication and authorized private presentation.
  The public board does not consume Torvik comparisons. Do not describe this
  prepared producer as an end-to-end connected board or automatic live feed.

## Private consumer (code prepared, deployment unverified)

The board's CBB controls offer **Load owner-only Torvik comparison**. This is an
explicit read of the existing private snapshot, not a source refresh. The request
uses the existing owner-authenticated endpoint with `?view=torvik`; authentication
still precedes storage. This view reads one projection object and skips markets.
It returns only derived comparison scores, exact fixture identities, retrieval
and expiry labels. Raw input rows and receipt hashes are excluded. Anonymous CBB
summaries remain unchanged. Nothing is loaded automatically or saved in browser
storage; Hide clears the private comparison from view.

Open a matching game to view its comparison. The UI distinguishes expired, started,
and status-unverified games; provider update time remains unknown. Source ratings
plus FBIS formula are labeled separately from Torvik's published game forecasts.
No comparison affects the primary score, prices, sorting, edges, or wagers.
A missing admitted producer snapshot remains unavailable rather than fabricated.

Private comparison freshness ends at the earlier of the packet expiry or six
hours after the oldest required source receipt. Repackaging cannot renew source
freshness. Expired comparisons remain explicitly historical and cannot authorize wagers.

## Per-comparison computation time
The runner finalizes the CBB packet timestamp after computing its comparisons.
Each Torvik comparison carries its own `generatedAt`. Computation must occur
after both source receipts, at or before packet finalization, before tip, and
strictly within six hours of both receipts. The private view checks this ordering
and the effective expiry. Repackaging cannot refresh the source receipt or
comparison computation times.
Old comparisons without this timestamp fail closed rather than being restamped.
Deploy producer and consumer together; this patch does not backfill old packets,
refresh source access, authorize bulk requests, or activate the generic recovery
runner. Offline fixture tests cover capture → formula → private summary → matching
card, plus source-stale, future-receipt, post-tip, and missing-time rejection.


The producer-to-consumer regression test uses the actual finalization order:
source receipts → comparison computation → packet finalization → private read.
A comparison dated after its finalized packet is rejected, as are comparisons
from before either receipt, at/after tip, or at/after source expiry. This code fix
does not itself verify scheduled bulk collection or packet publication.


## Current bulk four-factor layout
The reader accepts the exact legacy 25-column header, or the observed 2027
37-column header with 41 cells per team row. In the latter format, the first 25
columns are unchanged. The extra named columns are `ft%`, `ft%D`, `3P rate`,
`3P rate D`, `arate`, and `arateD`, each followed by a rank. Four trailing cells
have no header labels. Only the established first 25 columns are consumed; all
extension cells are ignored, never guessed, weighted, or publicly exposed.
Unexpected headers, reordered core columns, and unexpected row widths fail
closed. Current receipt timestamps still mean retrieval, not provider update.


## Same-job capture reuse
The existing 12:20 UTC schedule is unchanged. Its first date pass captures at
most two Torvik CSVs into a mode-0600 ephemeral runner file. This also prepares
the next date when the first date has no remaining CBB games. The second date
pass reads that file with a zero-call Torvik source budget. Missing, malformed,
wrong-season, stale, or future-dated input is unavailable and never triggers a
source retry. Both passes retain the exact original receipts and six-hour age.
The file is deleted in an `always()` cleanup step and excluded from artifacts.
Only existing projection packets are published; no extra R2 object, market
call, D1 call, model coefficient, or primary KenPom value is introduced.

This is one capture pair per eligible scheduled run, not permission to issue
additional diagnostics or manual refreshes that day. Automatic operation is
verified only after the scheduled receipts and private consumer are observed.
Comparisons can expire before evening or next-day tipoffs; reuse never extends
the six-hour source lifetime to make them look current.


Rollout is additionally held until November 10, 2026 UTC. With the unchanged
12:20 UTC schedule, the first eligible automatic pair is November 10 at 12:20
UTC. This conservative workflow date avoids additional November 9 collection
after diagnostics. The source registry specifies daily cadence but no reset
timezone; the hold is not evidence of a provider quota reset or new allowance.
