#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";

const YEAR=process.env.WTA_YEAR||"";
const GROUP=process.env.WTA_TOURNAMENT_GROUP_ID||"";
const CONFIRM=process.env.WTA_PRODUCTION_CONFIRM||"";
const DRY=process.env.WTA_PRODUCTION_DRY_RUN==="1";
if(!/^20\d\d$/.test(YEAR))throw new Error("WTA_YEAR is required");
if(!GROUP)throw new Error("WTA_TOURNAMENT_GROUP_ID is required");
if(!DRY&&CONFIRM!=="WRITE_ONE_WTA_SHARD")throw new Error("production confirmation missing");
const root=process.env.WTA_PRODUCTION_DIR||"artifacts/wta-production";
const rawDir=path.join(root,"raw");
const sql=path.join(root,"wta.sql");
const summary=path.join(root,"summary.json");
await fs.mkdir(root,{recursive:true});
const env={...process.env,WTA_YEAR:YEAR,WTA_TOURNAMENT_GROUP_ID:GROUP,WTA_TOURNAMENT_LIMIT:"1",WTA_RAW_DIR:rawDir,WTA_MATCH_SQL:sql,WTA_MATCH_SUMMARY:summary};
const run=(cmd,args,opts={})=>{const r=spawnSync(cmd,args,{stdio:"inherit",env,...opts});if(r.status!==0)throw new Error(`${cmd} failed ${r.status}`);};
run(process.execPath,["scripts/tennis-wta-match-history-ingest.mjs"]);
const s=JSON.parse(await fs.readFile(summary,"utf8"));
if(s.tournamentsAttempted!==1||s.failures||s.recordsSeen<1||s.recordsWritten<1)throw new Error("unsafe acquisition summary");
const shard=s.shards.find(x=>x.status==="COMPLETE");
if(!shard||!shard.rawKey||!shard.checksum)throw new Error("missing complete shard provenance");
const raw=path.join(rawDir,String(shard.year),String(shard.gid),"matches.json");
await fs.access(raw);
const bytes=await fs.readFile(raw);
const crypto=(await import("node:crypto")).default;
const actual=crypto.createHash("sha256").update(bytes).digest("hex");
if(actual!==shard.checksum)throw new Error("raw checksum mismatch");
if(DRY){console.log(JSON.stringify({dryRun:true,year:YEAR,group:GROUP,records:s.recordsSeen,checksum:actual,rawKey:shard.rawKey},null,2));process.exit(0);}
run("npx",["wrangler","r2","object","put",`fbis-archive/${shard.rawKey}`,"--file",raw,"--remote"]);
run("npx",["wrangler","r2","object","get",`fbis-archive/${shard.rawKey}`,"--file",path.join(root,"verified-raw.json"),"--remote"]);
const verified=await fs.readFile(path.join(root,"verified-raw.json"));
if(crypto.createHash("sha256").update(verified).digest("hex")!==actual)throw new Error("R2 verification checksum mismatch");
run("npx",["wrangler","d1","execute","fbis","--remote","--file",sql]);
console.log(JSON.stringify({productionWrite:true,year:YEAR,group:GROUP,records:s.recordsSeen,checksum:actual,rawKey:shard.rawKey},null,2));
