# FBIS static board release

Cloudflare Pages build root: `deploy/board`. Build command: `npm run build`.
Output: `dist`. This root has no Functions; its local Wrangler configuration has
no runtime bindings and prevents inheritance of the parent application's config.
The existing application and its API code remain in the repository for completion.

The released board serves schedules and observed scores only. The live ticker and game cards refresh every 60 seconds while the browser tab is visible,
with at most sixteen credential-free ESPN scoreboard requests per refresh. Hidden tabs
stop polling; focus/visibility return resumes an overdue refresh. Requests do not overlap. No public request can run D1,
R2, a model API, a collector, or wager writes. A failed source remains unavailable;
the saved publication's timestamp is preserved when live refresh fails. Captures
expire after five minutes and are displayed as stale, never silently freshened.

Do not re-enable old collectors or replace this root with the full application until
the account budget, model lineage, sport routing and retained-data gates pass.
Google Drive remains the private historical/recovery store; it is not a public API.
