# Canonical production deployment

Canonical production is **https://fbis-myz.pages.dev/** (Cloudflare Pages project `fbis`).

The GitHub **Deploy Pages** workflow is **not** the production deployment mechanism while `CLOUDFLARE_API_TOKEN` is unset as a GitHub Actions secret. A failed or skipped GitHub deploy job does not change what production serves.

## Direct authenticated Cloudflare path (canonical)

From a trusted machine with Wrangler authenticated to account `2fdc80b8d99070adcef12f7a785c3fc1`:

```bash
git rev-parse HEAD
npm ci
npm run verify:migrations
npm test
npm run build
npx wrangler pages deploy dist --project-name fbis --branch main --commit-hash "$(git rev-parse HEAD)" --commit-message "deploy $(git rev-parse HEAD)"
```

Then verify:

```bash
curl -sS https://fbis-myz.pages.dev/api/health | jq '{ok,deploymentCommit,build}'
```

Require:

- Full 40-character `deploymentCommit` equals `git rev-parse HEAD` and `origin/main`
- `build.schemaVersion` / migration `0013_probability_integrity` **VERIFIED**
- Semantic smoke (not merely HTTP 200): pause state, D1 read/write/readback, TODAY sport/date, BETS load, SYS integrity (no placeholder zeros)

Do not treat GitHub Actions `success` on an unused deploy workflow as production proof.

## SHA agreement for scheduled collection

The research pipeline (`harvest.yml`) fail-closes if production `/api/health` SHA does not match `github.sha` of `origin/main`. Do not push `main` (and do not deploy a different SHA) immediately before a scheduled collect if you need that slot to verify the currently serving commit.

See `docs/canonical-deployment.md` and `docs/phase1-mlb.md`.
