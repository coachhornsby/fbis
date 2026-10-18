#!/usr/bin/env node
/** Merge chunk JSON files into the Oct 17 replay fixture. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
const dir = "artifacts/cfb-oct17-replay";
mkdirSync(dir, { recursive: true });
const closes = JSON.parse(readFileSync(`${dir}/closes.json`, "utf8"));
const chunks = readdirSync(`${dir}/chunks`)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(`${dir}/chunks/${f}`, "utf8")));
const fixture = {
  source: "d1-via-cloudflare-api-slim",
  fetchedAt: new Date().toISOString(),
  closes,
  features: chunks.map((r) => ({
    team_id: r.team_id,
    as_of: r.as_of,
    features_json: JSON.stringify(r),
  })),
};
writeFileSync(`${dir}/fixture.json`, JSON.stringify(fixture));
console.log(JSON.stringify({ closes: closes.length, features: fixture.features.length }));
