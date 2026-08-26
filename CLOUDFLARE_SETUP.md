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

Cache is not a substitute for history. Create and apply:

```bash
npx wrangler d1 create fbis
npx wrangler d1 execute fbis --file=schema.sql --remote
```

Bind `DB` on the Pages project (`fbis`). Put the `database_id` in `wrangler.toml` under `[[d1_databases]]` with `binding = "DB"`. Until that binding exists, freeze/harvest still use the Cache API (~21 days) and SYS shows **RESEARCH DB UNBOUND**.

## Scheduled collection

Pages cannot use `wrangler.toml` `[triggers]`. GitHub Action `.github/workflows/harvest.yml`:

- Collect (CDT): 8am, 11am, 1pm, 3pm, 5pm, 7pm, 9pm CT — `0 13,16,18,20,22,0,2 * * *` UTC
- Full Parlay odds only at 8am and 11am CT; later collects are `parlayCacheOnly`
- Harvest finals: `20 11 * * *` UTC (~06:20 CT), scoreboard only, no Parlay

Optional: set `HARVEST_SECRET` as a Pages secret and a GitHub Actions secret of the same name. `/api/collect` and `/api/harvest` both require it when set.

## Git connect

1. https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages/connect
2. Repo: `coachhornsby/fbis` (after you push)
3. Project name: `fbis`
4. Build command: `npm run build`
5. Output directory: `dist`
