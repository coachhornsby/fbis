/**
 * Primary-D1-unavailable recovery writes for Polymarket US WebSocket ticks.
 * Uses the existing MARKET_HISTORY_DB binding only — not a second collector.
 * Never claims primary insert success. Never enables wagering.
 */
import {persistNormalizedMarketBatch} from "../../functions/lib/marketObservationLedger.js";

const LEDGER_DDL=`CREATE TABLE IF NOT EXISTS normalized_market_observations (
  id TEXT PRIMARY KEY,
  observation_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  sport TEXT NOT NULL,
  league TEXT,
  canonical_event_id TEXT,
  provider_event_id TEXT,
  event_start_time TEXT,
  home_team TEXT,
  away_team TEXT,
  canonical_player_id TEXT,
  provider_player_id TEXT,
  player_name TEXT,
  team TEXT,
  opponent TEXT,
  market_family TEXT NOT NULL,
  stat_family TEXT,
  side TEXT,
  line REAL,
  american_odds REAL,
  decimal_odds REAL,
  contract_price REAL,
  payout_multiplier REAL,
  standard_or_alt TEXT,
  promo INTEGER,
  period TEXT,
  source_market_id TEXT,
  source_outcome_id TEXT,
  source_observed_at TEXT,
  collected_at TEXT NOT NULL,
  snapshot_type TEXT NOT NULL DEFAULT 'CURRENT',
  model_id TEXT,
  model_version TEXT,
  model_probability REAL,
  fair_american_price REAL,
  raw_implied_probability REAL,
  no_vig_market_probability REAL,
  probability_edge REAL,
  expected_return_per_unit_risk REAL,
  execution_eligible INTEGER,
  decision_eligible INTEGER NOT NULL DEFAULT 0,
  can_qualify INTEGER NOT NULL DEFAULT 0,
  can_authorize_wager INTEGER NOT NULL DEFAULT 0,
  result_value REAL,
  result_side TEXT,
  settled_at TEXT,
  raw_payload_json TEXT,
  raw_payload_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_norm_market_event_time ON normalized_market_observations(sport,canonical_event_id,collected_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_source ON normalized_market_observations(source,sport,market_family,collected_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_snapshot ON normalized_market_observations(snapshot_type,sport,collected_at);`;

export async function ensureHistoryLedgerSchema(db){
  if(!db?.exec&&!db?.prepare)return {ok:false,reason:"database-unavailable"};
  if(typeof db.exec==="function"){
    await db.exec(LEDGER_DDL);
  }else{
    for(const stmt of LEDGER_DDL.split(";").map(s=>s.trim()).filter(Boolean)){
      await db.prepare(stmt).run();
    }
  }
  return {ok:true};
}

/** Persist WS offers to market-history when primary D1 cannot accept writes. */
export async function persistStreamRecoveryBatch(env,offers,{collectedAt=null}={}){
  if(!env?.MARKET_HISTORY_DB?.prepare)return {attempted:0,inserted:0,ok:false,reason:"history-binding-missing"};
  if(!Array.isArray(offers)||!offers.length)return {attempted:0,inserted:0,ok:false,reason:"empty-offers"};
  await ensureHistoryLedgerSchema(env.MARKET_HISTORY_DB);
  const r=await persistNormalizedMarketBatch(env.MARKET_HISTORY_DB,offers,{
    snapshotType:"CURRENT",
    collectedAt:collectedAt||new Date().toISOString(),
    modelProbability:null,
  });
  return {
    attempted:r.attempted,
    inserted:r.inserted,
    ids:r.ids||[],
    ok:r.inserted>0,
    target:"MARKET_HISTORY_DB",
    primaryIsAuthoritative:false,
    recoveryOnly:true,
    canAuthorizeWager:false,
  };
}
