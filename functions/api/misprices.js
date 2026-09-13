/**
 * Misprices API — MODEL DISAGREEMENT vs calibrated edge.
 * Does not invent EV. ACTION remains non-authoritative.
 */

import {
  evaluateMisprice,
  rankMisprices,
  MISPRICE_STATE,
  listModels,
  autoPromoteAllowed,
} from "../lib/canonical/index.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "all").toLowerCase();

  const rows = [];
  try {
    const db = context.env?.DB;
    if (db) {
      const stored = await db
        .prepare(
          `SELECT id, sport, event_id, player_id, market_type, model_id, state, label,
                  projection, market_line, disagreement_units, model_probability,
                  expected_value, can_show_ev, information_cutoff, market_timestamp, created_at
           FROM canonical_misprice_snapshots
           WHERE (? = 'all' OR sport = ?)
           ORDER BY created_at DESC
           LIMIT 200`
        )
        .bind(sport, sport)
        .all()
        .catch(() => ({ results: [] }));
      for (const r of stored.results || []) {
        rows.push({
          id: r.id,
          sport: r.sport,
          eventId: r.event_id,
          playerId: r.player_id,
          marketType: r.market_type,
          modelId: r.model_id,
          state: r.state,
          label: r.label,
          projection: r.projection,
          marketLine: r.market_line,
          disagreementUnits: r.disagreement_units,
          modelProbability: r.can_show_ev ? r.model_probability : null,
          expectedValue: r.can_show_ev ? r.expected_value : null,
          canShowEv: Boolean(r.can_show_ev),
          informationCutoff: r.information_cutoff,
          marketTimestamp: r.market_timestamp,
          createdAt: r.created_at,
        });
      }
    }
  } catch {
    // fail open to empty research board
  }

  const examples = [];
  if (rows.length === 0) {
    const demo = evaluateMisprice({
      modelId: "CFB-FBIS-v2",
      projection: 24.5,
      marketLine: 21.0,
      calibrationLocked: false,
      marketFresh: true,
      identityResolved: true,
    });
    examples.push({
      id: "contract-example-disagreement",
      sport: "cfb",
      marketType: "spread",
      modelId: "CFB-FBIS-v2",
      ...demo,
      note: "Contract example only — not a live slate row. Live rows appear after snapshot jobs write canonical_misprice_snapshots.",
    });
  }

  const ranked = rankMisprices(rows.length ? rows : examples);
  const models = listModels(sport === "all" ? {} : { sport });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    sport,
    qualityStatus: rows.length ? "OK" : "PARTIAL",
    freshness: rows.length ? "d1-snapshots" : "contract-example",
    states: Object.values(MISPRICE_STATE),
    policy: {
      uncalibratedLabel: "Model disagreement",
      evRequires: "CALIBRATED_EDGE or higher",
      actionAuthoritative: false,
      autoPromoteAllowed: autoPromoteAllowed(),
    },
    modelCount: models.length,
    count: ranked.length,
    misprices: ranked,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
