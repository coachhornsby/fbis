#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const mode=args.mode, input=args.input, discovery=args.discovery||null, out=args.out||"artifacts/nba-observation-health.sql";
const now=args.now||new Date().toISOString(), q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const read=p=>p&&fs.existsSync(p)&&fs.statSync(p).size?JSON.parse(fs.readFileSync(p,"utf8")):null;
let row;
if(mode==="lineup"){
 const j=read(input)||{}, meta=Array.isArray(j.meta)?j.meta:[], normalized=Number(j.quality?.observations||j.rows?.length||0);
 const failed=meta.filter(x=>x.ok===false).length, sourceRows=meta.reduce((n,x)=>n+Number(x.starterRows||0),0);
 row={pathKey:"OFFICIAL_LINEUP",source:j.source||"ESPN_CONFIRMED_STARTER",attempt:now,success:j.ok?now:null,sourceRows,normalized,persisted:normalized,rejected:failed,
  zeroReason:normalized?null:(failed&&failed===meta.length?"SOURCE_FETCH_ERROR":"NO_CONFIRMED_STARTERS_AVAILABLE"),
  freshness:j.observedAt||null,error:j.ok?null:"COLLECTOR_ERROR",detail:{quality:j.quality||{},meta}};
}else if(mode==="availability"){
 const d=read(discovery)||{},j=read(input)||null, normalized=Number(j?.quality?.entries||0), coverage=Number(j?.quality?.teams||0);
 const hasReport=Boolean(d.url), ok=hasReport?Boolean(j?.ok):Boolean(d.reason==="no_official_report_found");
 row={pathKey:"OFFICIAL_AVAILABILITY",source:"NBA_OFFICIAL_INJURY_REPORT",attempt:d.discoveredAt||now,success:hasReport&&j?.ok?(j.observedAt||now):null,
  sourceRows:coverage,normalized,persisted:normalized+coverage,rejected:0,
  zeroReason:hasReport?(normalized||coverage?null:"REPORT_PARSED_ZERO_ROWS"):"EXPECTED_NO_SOURCE_DATA",
  freshness:j?.reportTimestamp||null,error:ok?null:(d.reason||"COLLECTOR_ERROR"),detail:{discovery:d,quality:j?.quality||null}};
}else throw new Error("mode must be lineup or availability");
const sql=`INSERT INTO nba_observation_health (path_key,source,last_attempted_fetch,last_successful_fetch,source_row_count,normalized_row_count,persisted_row_count,rejected_row_count,zero_row_reason,source_freshness,error_state,detail_json,updated_at) VALUES (${q(row.pathKey)},${q(row.source)},${q(row.attempt)},${q(row.success)},${row.sourceRows},${row.normalized},${row.persisted},${row.rejected},${q(row.zeroReason)},${q(row.freshness)},${q(row.error)},${q(JSON.stringify(row.detail))},${q(now)}) ON CONFLICT(path_key) DO UPDATE SET source=excluded.source,last_attempted_fetch=excluded.last_attempted_fetch,last_successful_fetch=COALESCE(excluded.last_successful_fetch,nba_observation_health.last_successful_fetch),source_row_count=excluded.source_row_count,normalized_row_count=excluded.normalized_row_count,persisted_row_count=excluded.persisted_row_count,rejected_row_count=excluded.rejected_row_count,zero_row_reason=excluded.zero_row_reason,source_freshness=excluded.source_freshness,error_state=excluded.error_state,detail_json=excluded.detail_json,updated_at=excluded.updated_at;`;
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true}); fs.writeFileSync(out,sql+"\n"); console.log(JSON.stringify(row,null,2));
