import test from "node:test";
import assert from "node:assert/strict";
import {captureKalshiComboTape,normalizeComboTrade} from "../functions/lib/kalshiComboTape.js";
const root="player-props/kalshi/v1/";
const combo={ticker:"KXMVE-FOO-AAA",eventTicker:"KXMVE-FOO",legs:[{marketTicker:"KX-A",eventTicker:"KX-E",side:"yes"},{marketTicker:"KX-B",eventTicker:"KX-F",side:"no"}]};
const trade={trade_id:"trade-123456",ticker:combo.ticker,created_time:"2026-10-20T15:00:00Z",yes_price_dollars:"0.3",count_fp:"25.50",taker_outcome_side:"yes",is_block_trade:true};
function archive(){const m=new Map();return{m,async get(k){return m.has(k)?{json:async()=>JSON.parse(m.get(k))}:null},async put(k,v){m.set(k,String(v))}}}
test("actual trade prints retain size, direction, legs and venue time without trading authority",()=>{
 const r=normalizeComboTrade(trade,combo);
 assert.equal(r.contracts,25.5);assert.equal(r.notionalDollars,7.65);
 assert.equal(r.legCount,2);assert.equal(r.isBlockTrade,true);assert.equal(r.executionEligible,false);
 assert.equal(normalizeComboTrade({...trade,trade_id:null},combo),null);
 assert.equal(normalizeComboTrade({...trade,ticker:"ANOTHER"},combo),null);
});
test("no complete combo market snapshot means zero public upstream trade calls",async()=>{
 const ARCHIVE=archive();let calls=0;
 const r=await captureKalshiComboTape({ARCHIVE},{fetchImpl:async()=>{calls++;throw Error("no")},now:new Date("2026-10-20T15:00:00Z")});
 assert.equal(r.code,"COMBO_SNAPSHOT_NOT_READY");assert.equal(calls,0);
});
test("sampled print dedupes and preserves research-only coverage",async()=>{
 const ARCHIVE=archive();ARCHIVE.m.set(root+"multi-snapshot.json",JSON.stringify({paginationComplete:true,records:[combo]}));
 const now=new Date("2026-10-20T15:00:00Z");
 const fetchImpl=async(url,req)=>{assert.equal(req.method,"GET");assert.equal(new URL(url).searchParams.get("ticker"),combo.ticker);return Response.json({trades:[trade,trade]})};
 const r=await captureKalshiComboTape({ARCHIVE},{now,fetchImpl});
 assert.equal(r.status,"SAMPLED");
 const saved=JSON.parse(ARCHIVE.m.get(root+"combo-tape.json"));
 assert.equal(saved.records.length,1);assert.equal(saved.fullTradeTapeCoverage,false);
 assert.equal(saved.records[0].canAuthorizeWager,false);
});
