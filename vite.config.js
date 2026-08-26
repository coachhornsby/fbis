import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildSlate } from "./functions/lib/slateEngine.js";
import { freezeSlate, buildTrackReport } from "./functions/lib/projLedger.js";

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
        if (!url.startsWith("/api/slate") && !url.startsWith("/api/ticker") && !url.startsWith("/api/track")) {
          next();
          return;
        }
        try {
          const parsed = new URL(url, "http://localhost");
          const sport = parsed.searchParams.get("sport") || "mlb";
          const date = parsed.searchParams.get("date") || "";
          if (url.startsWith("/api/track")) {
            const days = parsed.searchParams.get("days") || "8";
            const payload = await buildTrackReport(sport, days, {
              PARLAY_API_KEY: process.env.PARLAY_API_KEY,
              BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
            });
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return;
          }
          const payload = await buildSlate(sport, date, {
            PARLAY_API_KEY: process.env.PARLAY_API_KEY,
            BALLPARK_PAL_API_KEY: process.env.BALLPARK_PAL_API_KEY,
          });
          await freezeSlate(payload).catch(() => {});
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
