#!/usr/bin/env node
/** Read-only cross-week CFB source-to-projection reconciliation.
 * Usage: node scripts/cfb-projection-reconcile.mjs --sources week05.csv,week06.csv --predictions saved.json --out report.json
 * saved.json: array of captured FBIS receipts, never reconstructed forecasts.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {csvGames} from "./cfb-game-evidence-archive.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
const validTime=s=>typeof s==="string"&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
export function reconcile(files,receipts){
 if(!Array.isArray(files)||!files.length||!Array.isArray(receipts))throw Error("SOURCE_AND_RECEIPT_ARRAYS_REQUIRED");
 const sources=[],keys=new Set(),fingerprints=[];
 for(const {name,content} of files){
  const games=csvGames(content);fingerprints.push({source:name,sha256:hash(content),rows:games.length});
  for(const g of games){
   const key=g.season+":"+g.id;
   if(keys.has(key))throw Error("DUPLICATE_ACROSS_WEEKS:"+key);keys.add(key);
   if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(g.start_date))throw Error("INVALID_KICKOFF:"+key);
   sources.push({key,id:String(g.id),week:Number(g.week),season:Number(g.season),
    kickoffUtc:g.start_date.replace(" ","T")+"Z",home:g.home_team,away:g.away_team,
    sourceFile:name,operatorAttestedPublishedBeforeKickoff:true});
  }
 }
 const saved=new Map();
 for(const p of receipts){
  if(!p||!p.game_id&&!p.gameId)continue;
  const id=String(p.game_id??p.gameId),season=String(p.season??2026),key=season+":"+id;
  if(!saved.has(key))saved.set(key,[]);saved.get(key).push(p);
 }
 const rows=sources.map(g=>{
  const found=saved.get(g.key)||[];
  const valid=found.filter(p=>{
   const when=p.created_at??p.createdAt??p.captured_at??p.capturedAt??p.predicted_at??p.predictedAt;
   return validTime(when)&&Date.parse(when)<Date.parse(g.kickoffUtc)&&
    (p.model_version||p.modelVersion||p.model_id||p.modelId)&&
    (p.projected_margin!=null||p.projectedMargin!=null||p.home_win_probability!=null||p.homeWinProbability!=null);
  }).sort((a,b)=>Date.parse(a.created_at??a.createdAt??a.captured_at??a.capturedAt??a.predicted_at??a.predictedAt)-Date.parse(b.created_at??b.createdAt??b.captured_at??b.capturedAt??b.predicted_at??b.predictedAt));
  const candidate=valid[0];
  const status=candidate?"VERIFIED_SAVED_PREGAME_RECEIPT":found.length?"RECEIPT_FOUND_NOT_QUALIFIED":"MISSING_SAVED_PROJECTION";
  return {...g,status,receiptCount:found.length,validReceiptCount:valid.length,
   earliestCapture: candidate?(candidate.created_at??candidate.createdAt??candidate.captured_at??candidate.capturedAt??candidate.predicted_at??candidate.predictedAt):null,
   earliestModel: candidate?(candidate.model_version??candidate.modelVersion??candidate.model_id??candidate.modelId):null,
   receiptIdentity: candidate?(candidate.id??candidate.receipt_id??candidate.receiptId??null):null,
   resultStatus:"NOT_CHECKED",officialFinalVerified:false,graded:false};
 });
 const byWeek=Object.values(Object.groupBy(rows,r=>r.week)).map(rs=>({week:rs[0].week,games:rs.length,
  validSaved:rs.filter(r=>r.status==="VERIFIED_SAVED_PREGAME_RECEIPT").length,
  invalidSaved:rs.filter(r=>r.status==="RECEIPT_FOUND_NOT_QUALIFIED").length,
  missing:rs.filter(r=>r.status==="MISSING_SAVED_PROJECTION").length})).sort((a,b)=>a.week-b.week);
 return {schema:"fbis.cfb.projection_reconciliation.v1",source:"original_uploaded_weekly_training_documents",
  receiptSource:"external_read_only_export",total:rows.length,
  verifiedSaved:rows.filter(r=>r.status==="VERIFIED_SAVED_PREGAME_RECEIPT").length,
  matchedButInvalid:rows.filter(r=>r.status==="RECEIPT_FOUND_NOT_QUALIFIED").length,
  missing:rows.filter(r=>r.status==="MISSING_SAVED_PROJECTION").length,
  operatorAttestedPublication:true,promotionAuthorized:false,wagerAuthority:false,
  files:fingerprints,byWeek,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
 if(!["--sources","--predictions","--out"].every(k=>args.includes(k)&&value(k)))throw Error("REQUIRED: --sources comma-list --predictions saved.json --out report.json");
 const files=value("--sources").split(",").map(name=>({name,content:readFileSync(name,"utf8")}));
 const receipts=JSON.parse(readFileSync(value("--predictions"),"utf8"));
 const report=reconcile(files,receipts);
 writeFileSync(value("--out"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({total:report.total,verifiedSaved:report.verifiedSaved,missing:report.missing,matchedButInvalid:report.matchedButInvalid}));
}
