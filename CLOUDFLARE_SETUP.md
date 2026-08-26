# Cloudflare Pages — FBIS

Live site: **https://fbis-myz.pages.dev/**

Same path as CougarsDefense. Free tier. No DigitalOcean.

## CLI

```bash
npx wrangler pages secret put PARLAY_API_KEY --project-name fbis
npx wrangler pages secret put BALLPARK_PAL_API_KEY --project-name fbis
npm run deploy
```

Parlay odds are cached 15 minutes so the 1,000 free credits last. Pinnacle is pulled from the `eu` region. Kalshi is a separate 1-credit sentiment pull and is never used as a betting book.

## Git connect

1. https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/pages/connect
2. Repo: `coachhornsby/fbis` (after you push)
3. Project name: `fbis`
4. Build command: `npm run build`
5. Output directory: `dist`
