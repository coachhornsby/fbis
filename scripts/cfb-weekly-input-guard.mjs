#!/usr/bin/env node
/**
 * Offline pregame CFB weekly training CSV gate.
 * Generates a SHA-256 receipt and validated normalized rows; never writes D1,
 * changes production ratings, settles a game, or authorizes wagers.
 * Usage: node scripts/cfb-weekly-input-guard.mjs input.csv --observed-at 2026-10-26T13:47:00Z --out-dir artifacts/week09
 */
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";

export function parseCsv(source){
  const records=[];let row=[],cell="",quoted=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='"'){
      if(quoted&&source[i+1]==='"'){cell+='"';i++;}
      else if(quoted){quoted=false;}
      else if(!cell){quoted=true;}
      else throw Error("INVALID_QUOTING");
    }else if(quoted)cell+=c;
    else if(c===','){row.push(cell);cell="";}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);cell="";
      if(row.some(x=>x!==""))records.push(row);
      row=[];
    }else cell+=c;
  }
  if(quoted)throw Error("UNTERMINATED_QUOTE");
  if(row.length||cell){row.push(cell);records.push(row);}
  return records;
}
const required=["id","start_date","season","season_type","week","home_team","away_team","spread","home_adjusted_epa","away_adjusted_epa"];
const numeric=["spread","home_elo","away_elo","home_talent","away_talent"];
export function validateWeeklyCsv(source,{observedAt,expectedSeason=2026,expectedWeek=9}={}){
  const clock=Date.parse(observedAt);
  if(!observedAt||!Number.isFinite(clock)||!/(Z|[+-]\d\d:\d\d)$/.test(observedAt))throw Error("EXPLICIT_UTC_OBSERVATION_REQUIRED");
  const all=parseCsv(source.replace(/^\uFEFF/,""));
  if(all.length<2)throw Error("EMPTY_WEEKLY_SOURCE");
  const headers=all.shift();
  if(new Set(headers).size!==headers.length||headers.some(x=>!x))throw Error("DUPLICATE_OR_BLANK_HEADER");
  for(const k of required)if(!headers.includes(k))throw Error("MISSING_REQUIRED_COLUMN:"+k);
  const games=new Set(),rows=[];
  for(const [index,fields] of all.entries()){
    if(fields.length!==headers.length)throw Error("ROW_WIDTH_MISMATCH:"+(index+2));
    const r=Object.fromEntries(headers.map((h,i)=>[h,fields[i]]));
    if(!/^\d+$/.test(r.id)||games.has(r.id))throw Error("DUPLICATE_OR_INVALID_GAME_ID:"+(index+2));
    games.add(r.id);
    if(Number(r.season)!==expectedSeason||Number(r.week)!==expectedWeek||r.season_type!=="regular")throw Error("WRONG_SEASON_WEEK_OR_TYPE:"+r.id);
    if(!r.home_team?.trim()||!r.away_team?.trim()||r.home_team===r.away_team)throw Error("INVALID_MATCHUP:"+r.id);
    // Provider CSV has naive UTC timestamps. Refuse guessing another timezone.
    if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.start_date))throw Error("INVALID_SOURCE_TIME:"+r.id);
    const kickoff=Date.parse(r.start_date.replace(" ","T")+"Z");
    if(!Number.isFinite(kickoff)||kickoff<=clock)throw Error("NOT_PROSPECTIVE_AT_OBSERVATION:"+r.id);
    for(const key of headers){
      if(r[key]==="")throw Error("MISSING_CELL:"+r.id+":"+key);
      if(key.startsWith("home_")||key.startsWith("away_")||numeric.includes(key)){
        if(["home_team","away_team","home_conference","away_conference"].includes(key))continue;
        if(!Number.isFinite(Number(r[key])))throw Error("NONFINITE_FEATURE:"+r.id+":"+key);
      }
    }
    rows.push({...r,kickoff_utc:new Date(kickoff).toISOString()});
  }
  if(!rows.length)throw Error("NO_GAMES");
  return {season:expectedSeason,week:expectedWeek,observedAt:new Date(clock).toISOString(),rows};
}
export function produceReceipt(source,options){
  const checked=validateWeeklyCsv(source,options);
  return {schema:"fbis.cfb.weekly_training.pit.v1",sport:"cfb",season:checked.season,week:checked.week,
    sourceObservedAt:checked.observedAt,sha256:createHash("sha256").update(source).digest("hex"),
    rowCount:checked.rows.length,columns:parseCsv(source.replace(/^\uFEFF/,""))[0].length,
    minKickoff:checked.rows.reduce((a,r)=>a<r.kickoff_utc?a:r.kickoff_utc,checked.rows[0].kickoff_utc),
    maxKickoff:checked.rows.reduce((a,r)=>a>r.kickoff_utc?a:r.kickoff_utc,checked.rows[0].kickoff_utc),
    officialFinals:0,verifiedPossessions:0,wagerAuthority:false,modelPromotion:false,
    dataStatus:"UNSETTLED_PREGAME_FEATURES",gameIds:checked.rows.map(r=>r.id)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [csvPath,flag,observedAt,flagOut,outDir]=process.argv.slice(2);
    if(!csvPath||flag!=="--observed-at"||flagOut!=="--out-dir"||!outDir)throw Error("USAGE: input.csv --observed-at ISO_Z --out-dir DIR");
    const source=readFileSync(csvPath,"utf8");
    const receipt=produceReceipt(source,{observedAt});
    mkdirSync(outDir,{recursive:true});
    writeFileSync(join(outDir,"week09-receipt.json"),JSON.stringify(receipt,null,2)+"\n");
    // Retain identical source bytes for reproducibility; do not silently reformat.
    writeFileSync(join(outDir,"training_data_2026_week09.csv"),readFileSync(csvPath));
    process.stdout.write(JSON.stringify({status:"validated",...receipt})+"\n");
  }catch(e){console.error(String(e?.message||e));process.exitCode=1;}
}
