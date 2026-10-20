/**
 * Market-history writes for Polymarket US WebSocket ticks.
 * Prefer MARKET_HISTORY_2026Q4_DB. Never enables wagering.
 * Upserts compact latest_market_state on every tick; coalesces full ledger inserts.
 */
import {persistNormalizedMarketBatch} from "../../functions/lib/marketObservationLedger.js";
import {
  upsertLatestMarketStates,
  coalesceOffersForLedger,
  ensureLatestMarketStateSchema,
} from "../../functions/lib/latestMarketState.js";
import {
  shouldBlockMarketHistoryWrite,
} from "../../functions/lib/marketHistoryCapacity.js";
import {capacityAlertLevel} from "../../functions/lib/databaseOwnership.js";

/**
 * Per-database coalesce memory (WeakMap). Same Q4 binding across flushes coalesces;
 * new DB objects (tests) start clean. Worker may inject a durable Map via opts.coalesceMemory
 * (loaded from DO storage) so restarts do not lose coalesce effectiveness.
 */
const coalesceByDb=new WeakMap();
export function coalesceMemoryFor(db,injected=null){
  if(injected instanceof Map)return injected;
  if(!db||(typeof db!=="object"))return new Map();
  let mem=coalesceByDb.get(db);
  if(!mem){mem=new Map();coalesceByDb.set(db,mem);}
  return mem;
}

/** Serialize coalesce map for DO storage (cap entries to bound memory). */
export function serializeCoalesceMemory(mem,maxEntries=5000){
  if(!(mem instanceof Map))return [];
  const limit=Math.max(1,Number(maxEntries)||5000);
  const entries=[...mem.entries()].slice(-limit);
  return entries.map(([k,v])=>({k,p:v?.contract_price??v?.contractPrice??null,c:v?.collected_at??v?.collectedAt??null}));
}

export function hydrateCoalesceMemory(entries){
  const mem=new Map();
  if(!Array.isArray(entries))return mem;
  for(const e of entries){
    if(!e||e.k==null)continue;
    mem.set(String(e.k),{contract_price:e.p,collected_at:e.c});
  }
  return mem;
}

async function probeHistoryBytes(db){
  if(!db?.prepare)return null;
  try{
    const result=await db.prepare("SELECT 1 AS healthy").all();
    const bytes=Number(result?.meta?.size_after);
    return Number.isSafeInteger(bytes)&&bytes>0?bytes:null;
  }catch{return null;}
}

const LEDGER_STATEMENTS=[
`CREATE TABLE IF NOT EXISTS normalized_market_observations (
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
)`,
`CREATE INDEX IF NOT EXISTS idx_norm_market_event_time ON normalized_market_observations(sport,canonical_event_id,collected_at)`,
`CREATE INDEX IF NOT EXISTS idx_norm_market_source ON normalized_market_observations(source,sport,market_family,collected_at)`,
`CREATE INDEX IF NOT EXISTS idx_norm_market_snapshot ON normalized_market_observations(snapshot_type,sport,collected_at)`,
];

async function tableColumns(db){
  if(!db?.prepare)return [];
  try{
    const r=await db.prepare("PRAGMA table_info(normalized_market_observations)").all();
    return (r?.results||[]).map(x=>x.name).filter(Boolean);
  }catch{return []}
}

export async function ensureHistoryLedgerSchema(db){
  if(!db?.prepare)return {ok:false,reason:"database-unavailable"};
  const existing=await tableColumns(db);
  if(existing.includes("id")&&existing.includes("source")&&existing.includes("collected_at")){
    return {ok:true,skipped:true,columns:existing.length};
  }
  // Prefer one statement at a time — multi-statement exec is unreliable on D1.
  for(const sql of LEDGER_STATEMENTS){
    const st=db.prepare(sql);
    if(typeof st.run==="function")await st.run();
    else if(typeof st.bind==="function")await st.bind().run();
  }
  const columns=await tableColumns(db);
  if(!columns.includes("id"))return {ok:false,reason:"ledger-create-failed"};
  return {ok:true,skipped:false,columns:columns.length};
}

/**
 * Prefer Q4. Legacy MARKET_HISTORY_DB only with MARKET_HISTORY_ALLOW_LEGACY_WRITE=enabled.
 * No silent fallback — matches WS persist / bootstrap fail-closed routing.
 * Synchronous binding check only; capacity gating uses resolveMarketHistoryWriteDb.
 */
export function resolveRecoveryHistoryDb(env){
  if(env?.MARKET_HISTORY_2026Q4_DB?.prepare){
    return {db:env.MARKET_HISTORY_2026Q4_DB,target:"MARKET_HISTORY_2026Q4_DB"};
  }
  if(env?.MARKET_HISTORY_ALLOW_LEGACY_WRITE==="enabled"&&env?.MARKET_HISTORY_DB?.prepare){
    return {db:env.MARKET_HISTORY_DB,target:"MARKET_HISTORY_DB"};
  }
  return {
    db:null,
    target:null,
    reason:"MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED",
  };
}

/** Persist WS offers to market-history (Q4 preferred) with coalesce + latest-state. */
export async function persistStreamRecoveryBatch(env,offers,{collectedAt=null,now=new Date(),coalesceMemory=null}={}){
  if(!Array.isArray(offers)||!offers.length)return {attempted:0,inserted:0,ok:false,reason:"empty-offers"};

  // Binding first (create schema if needed), then capacity fail-closed from HIGH.
  const binding=resolveRecoveryHistoryDb(env);
  if(!binding.db){
    return {
      attempted:offers.length,
      inserted:0,
      ok:false,
      reason:binding.reason||"MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED",
      blocked:true,
      canAuthorizeWager:false,
    };
  }
  const historyDb=binding.db;
  const historyTarget=binding.target;

  try{
    const schema=await ensureHistoryLedgerSchema(historyDb);
    if(!schema.ok)return {attempted:offers.length,inserted:0,ok:false,reason:schema.reason||"schema-unavailable"};
    await ensureLatestMarketStateSchema(historyDb);

    const bytes=await probeHistoryBytes(historyDb);
    const capacity=bytes==null?null:capacityAlertLevel(bytes);
    if(capacity){
      const gate=shouldBlockMarketHistoryWrite(capacity);
      if(gate.blocked){
        return {
          attempted:offers.length,
          inserted:0,
          ok:false,
          reason:gate.reason,
          blocked:true,
          capacity,
          target:historyTarget,
          canAuthorizeWager:false,
        };
      }
    }

    const at=collectedAt||(now instanceof Date?now.toISOString():String(now));
    const nowMs=now instanceof Date?now.getTime():Date.parse(String(now))||Date.now();
    const mem=coalesceMemoryFor(historyDb,coalesceMemory);
    const coalesced=coalesceOffersForLedger(offers,mem,{nowMs});

    // Always refresh compact latest state (board/compare hot path).
    const latest=await upsertLatestMarketStates(historyDb,offers,{
      collectedAt:at,
      snapshotType:"CURRENT",
    });

    let r={attempted:0,inserted:0,ids:[]};
    if(coalesced.ledgerOffers.length){
      r=await persistNormalizedMarketBatch(historyDb,coalesced.ledgerOffers,{
        snapshotType:"CURRENT",
        collectedAt:at,
        modelProbability:null,
      });
    }
    const ok=latest.ok||r.inserted>0||coalesced.skipped.length===offers.length;
    return {
      attempted:offers.length,
      inserted:r.inserted,
      ids:r.ids||[],
      latestUpserted:latest.upserted||0,
      coalescedSkipped:coalesced.skipped.length,
      ledgerAttempted:coalesced.ledgerOffers.length,
      ok,
      reason:r.inserted>0
        ?"history-insert-ok"
        :(latest.ok?"latest-state-only":"history-insert-zero"),
      target:historyTarget,
      capacity,
      primaryIsAuthoritative:false,
      recoveryOnly:true,
      canAuthorizeWager:false,
      schema,
    };
  }catch(error){
    return {
      attempted:offers.length,
      inserted:0,
      ok:false,
      reason:String(error?.message||error||"history-persist-failed").slice(0,240),
      target:historyTarget,
      recoveryOnly:true,
    };
  }
}
