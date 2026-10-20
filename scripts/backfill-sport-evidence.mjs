#!/usr/bin/env node
/**
 * Backfill sport-shard evidence envelopes from PRIMARY.
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 * Does not set sport authority. Shadow-only writes.
 *
 * Usage:
 *   node scripts/backfill-sport-evidence.mjs --sport nfl
 *   node scripts/backfill-sport-evidence.mjs --sport cfb --page-size 40
 */
import { buildPredictionEvidenceEnvelope } from "../functions/lib/canonicalEvidenceContract.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DBS = {
  primary: "b50c724c-903b-4241-8ce1-48d931e7a44c",
  nfl: "0a49cad0-4bf9-4e01-88ce-be54123f712d",
  cfb: "b589c91c-c53d-4f4a-9d32-99c4468e3033",
  nhl: "a0aa010c-40d3-4d2f-8109-eca4e74e2a73",
};

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function d1(dbId, body) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${dbId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(JSON.stringify(json.errors || json).slice(0, 400));
  }
  return json.result || [];
}

async function q(dbId, sql, params) {
  const result = await d1(dbId, params ? { sql, params } : { sql });
  return result?.[0]?.results || [];
}

/** Prefer D1 batch writes — one round-trip per page instead of N. */
async function qBatch(dbId, statements) {
  if (!statements.length) return [];
  return d1(dbId, { batch: statements });
}

const UPSERT = `INSERT INTO prediction_snapshots(
  id,game_id,sport,model_version,projection_kind,proj_total,proj_home,proj_away,proj_margin,
  p_home_final,p_market,frozen_at,weights_json,layers_json,projection_flags,
  graded_at,actual_home,actual_away,deployment_commit,payload_json
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  game_id=excluded.game_id, sport=excluded.sport, model_version=excluded.model_version,
  projection_kind=excluded.projection_kind, proj_total=excluded.proj_total,
  proj_home=excluded.proj_home, proj_away=excluded.proj_away, proj_margin=excluded.proj_margin,
  p_home_final=excluded.p_home_final, p_market=excluded.p_market, frozen_at=excluded.frozen_at,
  weights_json=excluded.weights_json, layers_json=excluded.layers_json,
  projection_flags=excluded.projection_flags, graded_at=excluded.graded_at,
  actual_home=excluded.actual_home, actual_away=excluded.actual_away,
  deployment_commit=excluded.deployment_commit, payload_json=excluded.payload_json`;

async function main() {
  if (!ACCOUNT || !TOKEN) {
    console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
    process.exit(2);
  }
  const sport = String(arg("sport", "nfl")).toLowerCase();
  const pageSize = Math.min(100, Math.max(5, Number(arg("page-size", "40")) || 40));
  const sportId = DBS[sport];
  if (!sportId) {
    console.error(`unsupported sport: ${sport}`);
    process.exit(2);
  }

  let afterId = arg("after", "") || "";
  if (!afterId) {
    const cur = await q(
      sportId,
      `SELECT COALESCE(MAX(id),'') AS c FROM prediction_snapshots
       WHERE sport=? AND payload_json LIKE '%fbis-canonical-evidence-v1%'`,
      [sport]
    );
    afterId = cur[0]?.c || "";
  }

  let updated = 0;
  for (;;) {
    const rows = await q(
      DBS.primary,
      `SELECT * FROM prediction_snapshots WHERE sport=? AND id>? ORDER BY id ASC LIMIT ?`,
      [sport, afterId, pageSize]
    );
    if (!rows.length) break;
    const batch = rows.map((row) => {
      const envelope = buildPredictionEvidenceEnvelope(row);
      afterId = row.id;
      updated += 1;
      return {
        sql: UPSERT,
        params: [
          row.id, row.game_id, row.sport, row.model_version ?? null, row.projection_kind ?? null,
          row.proj_total ?? null, row.proj_home ?? null, row.proj_away ?? null, row.proj_margin ?? null,
          row.p_home_final ?? null, row.p_market ?? null, row.frozen_at ?? null,
          row.weights_json ?? null, row.layers_json ?? null, row.projection_flags ?? null,
          row.graded_at ?? null, row.actual_home ?? null, row.actual_away ?? null,
          row.deployment_commit ?? null, envelope,
        ],
      };
    });
    await qBatch(sportId, batch);
    const [envCount, total] = await Promise.all([
      q(sportId, `SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=? AND payload_json LIKE '%fbis-canonical-evidence-v1%'`, [sport]),
      q(sportId, `SELECT COUNT(*) n FROM prediction_snapshots WHERE sport=?`, [sport]),
    ]);
    console.log(JSON.stringify({
      sport, updated, afterId,
      envelopes: Number(envCount[0]?.n || 0),
      total: Number(total[0]?.n || 0),
      canAuthorizeWager: false,
    }));
    if (rows.length < pageSize) break;
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
