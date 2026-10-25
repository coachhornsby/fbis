#!/usr/bin/env node
// Research-only mirror of existing captured NBA PinnOdds observations.
// No provider calls, no reconstructed quote clocks, no wager authority.
import {mkdir,writeFile} from "node:fs/promises";
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const owner="ed992525-d2ed-4b1d-8a12-feeb2efa152c";
const shards=[["q4","e8b0b65d-90a6-4842-8ee7-0f85d75afb4c"],["q4b","bb240435-e227-43e9-b8a6-eb05f0c68d4c"]];
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?"NULL":String(Number(v));
if(!account||!token||process.env.CLOUDFLARE_D1_DATABASE_ID!==owner)throw Error("NBA_OWNER_CREDENTIALS_REQUIRED");
async function query(db,sql){
 const r=await fetch("https://api.cloudflare.com/client/v4/accounts/"+account+"/d1/database/"+db+"/query",
 {method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
 body:JSON.stringify({sql}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error("D1_HTTP_"+r.status);
 const body=await r.json();if(!body.success||body.result?.[0]?.success===false)
  throw Error("D1_QUERY_FAILED_"+JSON.stringify(body.errors||[]).slice(0,250));
 return body.result[0].results||[];
}
const schema=`CREATE TABLE IF NOT EXISTS nba_market_quote_research_mirror (
 id TEXT PRIMARY KEY, partition_name TEXT NOT NULL, canonical_event_id TEXT,
 source TEXT NOT NULL, market_family TEXT, side TEXT, line REAL, decimal_odds REAL,
 source_observed_at TEXT, collected_at TEXT NOT NULL, event_start_time TEXT,
 raw_payload_hash TEXT NOT NULL, provider_clock_verified INTEGER NOT NULL DEFAULT 0 CHECK(provider_clock_verified=0),
 can_qualify INTEGER NOT NULL DEFAULT 0 CHECK(can_qualify=0),
 can_authorize INTEGER NOT NULL DEFAULT 0 CHECK(can_authorize=0),
 mirrored_at TEXT NOT NULL
);`;
await query(owner,schema);
let imported=0,sourceRows=0,latest=null,priceRows=0;
for(const [name,db] of shards){
 let last="";
 while(true){
  const sql=`SELECT id,canonical_event_id,source,market_family,side,line,decimal_odds,source_observed_at,collected_at,event_start_time,raw_payload_hash
    FROM normalized_market_observations
    WHERE source='PinnOdds' AND sport='nba' AND id>${q(last)}
    ORDER BY id LIMIT 250`;
  const rows=await query(db,sql);if(!rows.length)break;
  for(let i=0;i<rows.length;i+=25){
   const subset=rows.slice(i,i+25);
   const values=subset.map(r=>{
    if(!/^nmo_[a-f0-9]{28}$/.test(r.id)||!r.raw_payload_hash||!Number.isFinite(Date.parse(r.collected_at)))throw Error("BAD_SOURCE_OBSERVATION");
    return `(${[q(r.id),q(name),q(r.canonical_event_id),q(r.source),q(r.market_family),q(r.side),num(r.line),
      num(r.decimal_odds),q(r.source_observed_at),q(r.collected_at),q(r.event_start_time),
      q(r.raw_payload_hash),"0","0","0",q(new Date().toISOString())].join(",")})`;
   });
   await query(owner,`INSERT OR IGNORE INTO nba_market_quote_research_mirror
   (id,partition_name,canonical_event_id,source,market_family,side,line,decimal_odds,source_observed_at,collected_at,event_start_time,raw_payload_hash,provider_clock_verified,can_qualify,can_authorize,mirrored_at)
   VALUES ${values.join(",")}`);
  }
  sourceRows+=rows.length;imported+=rows.length;
  for(const r of rows){if(!latest||r.collected_at>latest)latest=r.collected_at;if(r.decimal_odds!=null)priceRows++}
  last=rows.at(-1).id;
  if(rows.length<250)break;
 }
}
const [summary]=await query(owner,"SELECT COUNT(*) total,COUNT(DISTINCT canonical_event_id) games,MAX(collected_at) latest, SUM(CASE WHEN provider_clock_verified<>0 OR can_qualify<>0 OR can_authorize<>0 THEN 1 ELSE 0 END) unsafe FROM nba_market_quote_research_mirror");
if(Number(summary.unsafe)!==0)throw Error("RESEARCH_AUTHORITY_LEAK");
await mkdir("artifacts",{recursive:true});
const receipt={ok:true,sourceRows,attemptedMirrors:imported,sourceDecimalPriceRows:priceRows,
 mirror:summary,sourcePartitions:shards.map(x=>x[0]),canAuthorize:false,providerClockVerified:false,
 note:"Research collection timestamp only. Not executable price or prospective CLV."};
await writeFile("artifacts/nba-market-mirror.json",JSON.stringify(receipt,null,2)+"\n");
console.log(JSON.stringify(receipt));
