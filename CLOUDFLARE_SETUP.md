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

`npx wrangler d1 execute fbis --file=schema.sql --remote` is idempotent (`CREATE TABLE IF NOT EXISTS`). New tables include `team_form`, `team_form_games`, `daily_reports`, `strategies`, and `strategy_tickets`.

`npm run deploy` publishes the Pages function with that binding. Until D1 is bound, freeze/harvest still use the Cache API (~21 days) and SYS shows **RESEARCH DB UNBOUND**.

## Scheduled collection

Pages cannot use `wrangler.toml` `[triggers]`. GitHub Action `.github/workflows/harvest.yml`:

- Collect (CDT): 8am, 11am, 1pm, 3pm, 5pm, 7pm, 9pm CT — `0 13,16,18,20,22,0,2 * * *` UTC
- Full Parlay odds only at 8am and 11am CT; later collects are `parlayCacheOnly`
- Harvest finals: `20 11 * * *` UTC (~06:20 CT), scoreboard only, no Parlay

`HARVEST_SECRET` is a Pages secret and a GitHub Actions secret of the same name. `/api/collect` and `/api/harvest` both require it when set. After changing a Pages secret, redeploy so the Worker sees it.

## Git connect

1. https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages/connect
2. Repo: `coachhornsby/fbis` (after you push)
3. Project name: `fbis`
4. Build command: `npm run build`
5. Output directory: `dist`
