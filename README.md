# FBIS — Fastwater Betting Intelligence System

Operator dashboard for independent projections, Pinnacle pricing, +EV, and forecast grading.
Hosted on **Cloudflare Pages**. No droplet.

Live: **https://fbis-myz.pages.dev/**

FBIS is not a picks site. The loop is:

**forecast → no-vig price → compare to Pinnacle → require +EV → record → grade final → diagnose error → repeat**

Champion model weights do not auto-rewrite from last night’s W/L.

## Boards

MLB · NBA · NFL · CFB · CBB · **SYS** (forecast tracking)

College baseball was dropped. NBA was added.

## Book stack

One job per source. They are never interchangeable.

| Role | Source | Use |
|---|---|---|
| Execution | Heritage | Where you actually bet. Every rec is a Heritage ticket. |
| Sharp / fair | Pinnacle | Market layer, vig, no-vig, CLV. Parlay `eu` region. |
| Sentiment | Kalshi | Public implied probability only. Never a betting price. |
| MLB scores | Baseball Savant | Run projections from SP quality + team RPG. Not the 1.5 run line. |
| MLB matchups | Ballpark Pal | Optional overlay: simulated runs, F5, park, starter matchups. |

Parlay does not list Heritage. The number on the board is the Pinnacle line to shop at Heritage. If Pinnacle is missing, the market stays empty — Kalshi is not a fallback.

Every selection shows **Pinnacle vig** (two-way hold) and the no-vig probability. Fair American is `1/p`. EV is expectancy at the Pinnacle price. A projection is not a bet until it clears sport-aware edge **and** +3% EV.

Baseball run line is always **1.5** (full game) / **0.5** (F5).

## How scores are projected

- **MLB** — Savant expected pitcher quality × team runs/game × 1.04 home, clamped 2.3–7.2. Pal simulated runs replace Savant when the Pal key is live. Independent of the run line.
- **NBA / NFL / CFB / CBB** — Pinnacle total/spread split into implied team scores until an independent sim is wired. Win-prob still blends no-vig Pinnacle, ESPN, and W-L form.

Hover a Proj cell for the recipe. SYS explains every board.

## Tracking (SYS)

Pregame projections freeze on first sight and are never overwritten. `/api/track` harvests finals from MLB Stats / ESPN (no Parlay credits). SYS reports MAE, RMSE, bias, winner-hit, Brier (model vs market). Logged tickets stay a separate dataset from every-game forecast error.

Nightly harvest also runs when the board is left open, and on a 06:20 CT cron when Pages scheduled functions are enabled.

Model version: **FBIS-v1.0**

## Data

- MLB Stats API — schedule, scores, probable pitchers, F5 linescore (free)
- ParlayAPI — Pinnacle game lines (3 credits, `eu` region), cached 15 minutes. Kalshi sentiment is a 1-credit pull; empty Kalshi/F5 responses cache for 6 hours.
- Ballpark Pal — optional; set `BALLPARK_PAL_API_KEY` when you have it (15k requests/month)

Learning / ticket journal lives in the browser. Frozen projections also live in the Function cache for ~21 days.

## Local

```bash
npm install
npm run dev
```

Opens on port **5175**. Copy `.env.example` to `.env`.

## Deploy (free Cloudflare Pages)

```bash
npx wrangler pages secret put PARLAY_API_KEY --project-name fbis
npx wrangler pages secret put BALLPARK_PAL_API_KEY --project-name fbis
npm run deploy
```

Needs Wrangler logged in (`npx wrangler login`) or `CLOUDFLARE_API_TOKEN` in the environment.
