import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildSlate, resolveSlateDate } from "./functions/lib/slateEngine.js";
import { freezeSlate, buildTrackReport, harvestAll, collectBoards } from "./functions/lib/projLedger.js";
import { buildTodayBoard, resolveTodayDate } from "./functions/lib/todayBoard.js";
import { handleBetsGet, handleBetsPost } from "./functions/api/bets.js";

function loadDotEnv() {
  try {
    const text = readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

function slateMiddleware() {
  loadDotEnv();
  return {
    name: "fbis-slate-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/slate") && !url.startsWith("/api/ticker") && !url.startsWith("/api/track") && !url.startsWith("/api/harvest") && !url.startsWith("/api/collect") && !url.startsWith("/api/today") && !url.startsWith("/api/bets")) {
          next();
          return;
        }
        try {
          const parsed = new URL(url, "http://localhost");
          const sport = parsed.searchParams.get("sport") || "mlb";
          const date = parsed.searchParams.get("date") || "";
          if (url.startsWith("/api/bets")) {
            const env = {
              PARLAY_API_KEY: process.env.PARLAY_API_KEY,
              BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
              HARVEST_SECRET: process.env.HARVEST_SECRET,
              STRATEGY_IMPORT_SECRET: process.env.STRATEGY_IMPORT_SECRET,
            };
            const fakeReq = {
              url: parsed.href,
              headers: {
                get(name) {
                  const key = Object.keys(req.headers || {}).find((k) => k.toLowerCase() === String(name).toLowerCase());
                  const v = key ? req.headers[key] : null;
                  return Array.isArray(v) ? v[0] : v;
                },
              },
            };
            if (req.method === "OPTIONS") {
              res.statusCode = 204;
              res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
              res.setHeader("Access-Control-Allow-Headers", "content-type,x-strategy-secret,x-harvest-secret");
              res.end();
              return;
            }
            if (req.method === "POST") {
              const body = await readJsonBody(req);
              const result = await handleBetsPost(env, fakeReq, body);
              res.statusCode = result.status;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result.body));
              return;
            }
            const payload = await handleBetsGet(env, parsed);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          if (url.startsWith("/api/today")) {
            const resolved = resolveTodayDate(parsed.searchParams.get("date") || "");
            const payload = await buildTodayBoard(resolved.date, {
              PARLAY_API_KEY: process.env.PARLAY_API_KEY,
              BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          if (url.startsWith("/api/collect")) {
            const odds = parsed.searchParams.get("odds") === "full" ? "full" : "cache";
            const payload = await collectBoards(
              {
                PARLAY_API_KEY: process.env.PARLAY_API_KEY,
                BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
              },
              { odds }
            );
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          if (url.startsWith("/api/harvest")) {
            const days = parsed.searchParams.get("days") || "3";
            const payload = await harvestAll(days, {
              PARLAY_API_KEY: process.env.PARLAY_API_KEY,
              BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          if (url.startsWith("/api/track")) {
            const days = parsed.searchParams.get("days") || "season";
            const payload = await buildTrackReport(sport, days, {
              PARLAY_API_KEY: process.env.PARLAY_API_KEY,
              BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
            }, {
              checkpoint: parsed.searchParams.get("checkpoint") || "LATEST",
              version: parsed.searchParams.get("version") || "all",
              model: parsed.searchParams.get("model") || "ensemble",
              type: parsed.searchParams.get("type") || "perGame",
              year: parsed.searchParams.get("year") || "",
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          const resolved = resolveSlateDate(date);
          if (date && !resolved.ok) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: resolved.error, games: [], ticker: [], counts: {} }));
            return;
          }
          const payload = await buildSlate(sport, resolved.date, {
            PARLAY_API_KEY: process.env.PARLAY_API_KEY,
            BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
          });
          await freezeSlate(payload, {}).catch(() => {});
          if (url.startsWith("/api/ticker")) {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ items: payload.ticker, generatedAt: payload.generatedAt }));
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      });
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export default defineConfig({
  plugins: [react(), slateMiddleware()],
  server: {
    host: true,
    port: 5175,
  },
  preview: {
    host: true,
    port: 4175,
  },
});
