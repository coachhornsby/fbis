# Cloudflare Pages — FBIS

Live site: **https://fbis-myz.pages.dev/**

Same path as CougarsDefense. Free tier. No DigitalOcean.

## CLI

```bash
npx wrangler pages secret put PARLAY_API_KEY --project-name fbis
npx wrangler pages secret put BALLPARK_PAL_API_KEY --project-name fbis
npm run deploy
```

Parlay odds are cached 15 minutes so the 1,000 free credits last. Pinnacle is pulled from the `eu` region. Kalshi is a separate 1-credit sentiment pull and is never used as a betting book. `/api/slate?date=` only accepts today ± a couple of days.

## D1 (authoritative research store)

Cache is not a substitute for history. Database `fbis` is bound as `DB` in `wrangler.toml` (`database_id` `b50c724c-903b-4241-8ce1-48d931e7a44c`). Apply schema after create or schema changes:

```bash
npx wrangler d1 execute fbis --file=schema.sql --remote
```

`npx wrangler d1 execute fbis --file=schema.sql --remote` only creates missing tables. Column changes live in versioned `migrations/*.sql` and `schema_migrations`. After schema changes:

```bash
npx wrangler d1 execute fbis --file=migrations/0001_job_runs.sql --remote
npx wrangler d1 execute fbis --file=migrations/0002_strategy_ticket_prices.sql --remote
```

New tables include `team_form`, `team_form_games`, `daily_reports`, `strategies`, `strategy_tickets`, `job_runs`, and `schema_migrations`. SYS health is read from D1 `job_runs` / `store_meta`, not isolate memory.

`npm run deploy` publishes the Pages function with that binding. Until D1 is bound, freeze/harvest still use the Cache API (~21 days) and SYS shows **RESEARCH DB UNBOUND**.

## Scheduled collection

Pages cannot use `wrangler.toml` `[triggers]`. GitHub Action `.github/workflows/harvest.yml`:

UTC crons are fixed; Chicago wall time shifts with DST.

| UTC cron | CDT (UTC-5) | CST (UTC-6) |
|---|---|---|
| `0 13,16,18,20,22,0,2 * * *` | 8am, 11am, 1pm, 3pm, 5pm, 7pm, 9pm | 7am, 10am, noon, 2pm, 4pm, 6pm, 8pm |
| `20 11 * * *` harvest | ~06:20 CDT | ~05:20 CST |

The intended operator windows are the CDT column. Full Parlay odds only at the 8am and 11am CDT slots (`collect-full`); later collects are cache-only. Harvest is scoreboard only (no Parlay).

`HARVEST_SECRET` is a Pages secret and a GitHub Actions secret of the same name. The workflow sends it as the `x-harvest-secret` header, not a query string, and fails unless the JSON `status` is `success`. After changing a Pages secret, redeploy so the Worker sees it. A green `workflow_dispatch` does not prove the `schedule` trigger has fired.

## Git connect

1. https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages/connect
2. Repo: `coachhornsby/fbis` (after you push)
3. Project name: `fbis`
4. Build command: `npm run build`
5. Output directory: `dist`
