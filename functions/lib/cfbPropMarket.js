/**
 * CFB prop market comparison layer.
 * MODEL PROJECTION ≠ MARKET LINE ≠ EXECUTION SOURCE.
 * PrizePicks / NoVig / books never feed CFB-PLAYER-v1.
 */

import { probabilityAtThreshold } from "./cfbPlayerModel.js";
import { hashPayload } from "./collegeIdentity.js";

export const PROP_MARKET_VERSION = "cfb-prop-market-v1";

export const PROP_SOURCES = Object.freeze({
  PRIZEPICKS: "prizepicks",
  NOVIG: "novig",
  SPORTSBOOK: "sportsbook",
  MANUAL: "manual",
  IMPORT: "import",
});

/** Correlation tags for same-game multi-leg awareness (research only). */
export const CORRELATION_TAGS = Object.freeze({
  QB_PASS_YARDS_WR_REC_YARDS: "qb_pass_yards__wr_rec_yards",
  QB_PASS_YARDS_WR_RECEPTIONS: "qb_pass_yards__wr_receptions",
  QB_ATTEMPTS_WR_TARGETS: "qb_attempts__wr_targets",
  QB_PASS_OVER_RB_RUSH_UNDER: "qb_pass_over__rb_rush_script",
  QB_PASS_UNDER_RB_RUSH_OVER: "qb_pass_under__rb_rush_script",
  SAME_TEAM_SKILL: "same_team_skill",
  OPPOSING_TEAM: "opposing_team",
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Detect repository status of automated PrizePicks / NoVig feeds.
 * Returns interface status — does not scrape or fabricate live access.
 */
export function detectPropFeedStatus() {
  return {
    prizePicks: {
      automated: false,
      status: "interface-only",
      note: "No CFB PrizePicks API integration in repository. Accept manual/import lines only.",
      researchOnly: true,
      conventionalEvAllowed: false,
    },
    noVig: {
      automated: false,
      status: "interface-only",
      note: "NoVig slip OCR / sportsbook tools exist for team markets; no CFB player prop consensus feed. Import/manual only.",
      researchOnly: true,
      mayEnterIndependentModel: false,
    },
    sportsbookProps: {
      automated: false,
      status: "mlb-only-in-repo",
      note: "Existing propConviction path is MLB-only. CFB props use import interface.",
      researchOnly: true,
    },
    version: PROP_MARKET_VERSION,
  };
}

/**
 * Canonical prop market record (import/manual capable).
 */
export function buildPropMarketRecord({
  gameId,
  playerId = null,
  playerName = null,
  team = null,
  marketType,
  line,
  overPrice = null,
  underPrice = null,
  source = PROP_SOURCES.MANUAL,
  sportsbook = null,
  observedAt = null,
  marketQuality = null,
  importMode = "manual",
  payload = null,
} = {}) {
  if (!gameId || !marketType || !Number.isFinite(Number(line))) {
    return { ok: false, reason: "missing-required-fields" };
  }
  const src = String(source || PROP_SOURCES.MANUAL).toLowerCase();
  if (!Object.values(PROP_SOURCES).includes(src)) {
    return { ok: false, reason: "unknown-source" };
  }
  return {
    ok: true,
    record: {
      game_id: String(gameId),
      player_id: playerId,
      player_name: playerName,
      team,
      market_type: marketType,
      line: Number(line),
      over_price: num(overPrice),
      under_price: num(underPrice),
      source: src,
      sportsbook,
      observed_at: observedAt || new Date().toISOString(),
      market_quality: marketQuality,
      import_mode: importMode,
      payload,
      version: PROP_MARKET_VERSION,
    },
  };
}

/**
 * Compare FBIS player projection to a market threshold without mutating projection.
 */
export function compareProjectionToMarket(prop, marketRecord) {
  if (!prop || !marketRecord) {
    return { ok: false, reason: "missing-inputs" };
  }
  const line = num(marketRecord.line ?? marketRecord.record?.line);
  if (line == null) return { ok: false, reason: "missing-line" };

  const withProb = probabilityAtThreshold(prop, line);
  const diff = round2(Number(prop.projection) - line);
  const sigma = num(prop.sigma) || 1;
  const std = round2(diff / sigma);
  const source = marketRecord.source || marketRecord.record?.source;

  const out = {
    ok: true,
    player: prop.player,
    player_id: prop.player_id,
    market_type: prop.market,
    fbis_projection: prop.projection,
    fbis_sigma: prop.sigma,
    market_line: line,
    difference: diff,
    standardized_diff: std,
    probability_over: withProb.probabilityOver,
    probability_under: withProb.probabilityUnder,
    source,
    uncertainty_state: prop.uncertainty_state,
    data_quality: prop.data_quality,
    // Projection identity preserved
    projectionUnchanged: withProb.projection === prop.projection,
    decision_eligible: false,
    researchOnly: true,
  };

  if (source === PROP_SOURCES.PRIZEPICKS) {
    out.prizePicks = {
      threshold: line,
      pMore: withProb.probabilityOver,
      pLess: withProb.probabilityUnder,
      conventionalEv: null,
      conventionalEvReason: "PrizePicks payout structure required — EV not computed",
    };
  }

  return out;
}

/**
 * Tag pairwise correlation risk for same-game legs (research).
 */
export function tagPropCorrelations(legs = []) {
  const tags = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const sameGame = a.game_id && a.game_id === b.game_id;
      if (!sameGame) continue;
      const sameTeam = a.team && a.team === b.team;
      const pair = [a.market_type, b.market_type].sort().join("|");
      if (sameTeam) tags.push({ a: i, b: j, tag: CORRELATION_TAGS.SAME_TEAM_SKILL });
      else tags.push({ a: i, b: j, tag: CORRELATION_TAGS.OPPOSING_TEAM });

      if (
        (a.market_type === "passing_yards" && b.market_type === "receiving_yards") ||
        (b.market_type === "passing_yards" && a.market_type === "receiving_yards")
      ) {
        if (sameTeam) tags.push({ a: i, b: j, tag: CORRELATION_TAGS.QB_PASS_YARDS_WR_REC_YARDS, strength: "strong-positive" });
      }
      if (
        (a.market_type === "passing_yards" && b.market_type === "receptions") ||
        (b.market_type === "passing_yards" && a.market_type === "receptions")
      ) {
        if (sameTeam) tags.push({ a: i, b: j, tag: CORRELATION_TAGS.QB_PASS_YARDS_WR_RECEPTIONS, strength: "positive" });
      }
      if (
        (a.market_type === "passing_yards" && b.market_type === "rb_rushing_yards") ||
        (b.market_type === "passing_yards" && a.market_type === "rb_rushing_yards")
      ) {
        if (sameTeam) {
          tags.push({
            a: i,
            b: j,
            tag: CORRELATION_TAGS.QB_PASS_OVER_RB_RUSH_UNDER,
            strength: "script-dependent",
            note: "Game script can couple pass volume and rush volume inversely",
          });
        }
      }
      void pair;
    }
  }
  return {
    researchOnly: true,
    autoRecommend: false,
    tags,
    note: "Correlation tagging only — no automated PrizePicks entry construction",
  };
}

export async function propRecordId(record) {
  const hash = await hashPayload({
    gameId: record.game_id,
    playerId: record.player_id,
    market: record.market_type,
    line: record.line,
    source: record.source,
    observedAt: record.observed_at,
  });
  return `cfbprop:${hash.slice(0, 20)}`;
}
