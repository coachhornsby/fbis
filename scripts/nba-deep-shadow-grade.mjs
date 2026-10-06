#!/usr/bin/env node
import fs from "node:fs";
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const shadowFile=args.shadow||"artifacts/nba-deep-shadow-rows.json";
const canonicalFile=args.canonical||"artifacts/current/nba-canonical.jsonl";
const out=args.out||"artifacts/nba-deep-prospective-validation.json";
const sqlOut=args.sql||"artifacts/nba-deep-prospective-validation.sql";
const now=new Date().toISOString();
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=finite(v);return n==null?"NULL":String(n)};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function readJson(path){
  if(!fs.existsSync(path)||!fs.statSync(path).size)return[];
  const x=JSON.parse(fs.readFileSync(path,"utf8"));
  if(Array.isArray(x)){
    if(x.every(r=>Array.isArray(r?.results)))return x.flatMap(r=>r.results||[]);
    if(x.length===1&&Array.isArray(x[0]?.results))return x[0].results;
    return x;
  }
  if(Array.isArray(x?.results))return x.results;
  if(Array.isArray(x?.result))return x.result.flatMap(r=>r?.results||[]);
  return[];
}
function readJsonl(path){return fs.existsSync(path)&&fs.statSync(path).size?fs.readFileSync(path,"utf8").split("\n").filter(Boolean).map(JSON.parse):[]}
const rows=readJson(shadowFile),games=readJsonl(canonicalFile),byId=new Map(games.map(g=>[String(g.id),g]));
const graded=[];
const updates=[];
for(const r of rows){
  const g=byId.get(String(r.game_id));if(!g)continue;
  const ah=finite(g.homeScore),aa=finite(g.awayScore);if(ah==null||aa==null)continue;
  const am=ah-aa,at=ah+aa;
  const cm=finite(r.projected_margin),ct=finite(r.projected_total),im=finite(r.incumbent_margin),it=finite(r.incumbent_total);
  if([cm,ct,im,it].some(v=>v==null))continue;
  const row={...r,actualHome:ah,actualAway:aa,
    marginAbsError:Math.abs(cm-am),totalAbsError:Math.abs(ct-at),
    incumbentMarginAbsError:Math.abs(im-am),incumbentTotalAbsError:Math.abs(it-at),
    challengerWinnerCorrect:(cm>0)===(am>0),incumbentWinnerCorrect:(im>0)===(am>0)};
  graded.push(row);
  updates.push(`UPDATE nba_deep_game_shadow SET actual_home=${num(ah)},actual_away=${num(aa)},margin_abs_error=${num(row.marginAbsError)},total_abs_error=${num(row.totalAbsError)},incumbent_margin_abs_error=${num(row.incumbentMarginAbsError)},incumbent_total_abs_error=${num(row.incumbentTotalAbsError)},graded_at=${q(now)} WHERE id=${q(r.id)};`);
}
const im=mean(graded.map(r=>r.incumbentMarginAbsError)),cm=mean(graded.map(r=>r.marginAbsError));
const it=mean(graded.map(r=>r.incumbentTotalAbsError)),ct=mean(graded.map(r=>r.totalAbsError));
const iw=mean(graded.map(r=>r.incumbentWinnerCorrect?1:0)),cw=mean(graded.map(r=>r.challengerWinnerCorrect?1:0));
const mi=im?((im-cm)/im):null,ti=it?((it-ct)/it):null;
const evidencePass=graded.length>=100&&mi!=null&&ti!=null&&mi>=.005&&ti>=.003&&cw>=iw-.005;
const id="nba-deep-prospective:"+now;
const report={id,generatedAt:now,modelId:"NBA-FBIS-v2-DEEP",validationType:"PROSPECTIVE",n:graded.length,
  incumbentMarginMae:im,challengerMarginMae:cm,marginImprovement:mi,
  incumbentTotalMae:it,challengerTotalMae:ct,totalImprovement:ti,
  incumbentWinnerAccuracy:iw,challengerWinnerAccuracy:cw,evidencePass,
  decision:evidencePass?"PROSPECTIVE_EVIDENCE_PASS":"ACCUMULATING_OR_FAIL",
  governance:{autoPromote:false,canQualify:false,canAuthorize:false}};
const insert=`INSERT OR REPLACE INTO nba_deep_validation_runs (id,model_id,model_version,validation_type,training_start,training_cutoff,holdout_start,n,incumbent_margin_mae,challenger_margin_mae,margin_improvement,incumbent_total_mae,challenger_total_mae,total_improvement,incumbent_winner_accuracy,challenger_winner_accuracy,evidence_pass,details_json,created_at) VALUES (${q(id)},'NBA-FBIS-v2-DEEP','research-v1','PROSPECTIVE',NULL,NULL,NULL,${graded.length},${num(im)},${num(cm)},${num(mi)},${num(it)},${num(ct)},${num(ti)},${num(iw)},${num(cw)},${evidencePass?1:0},${q(JSON.stringify(report))},${q(now)});`;
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(sqlOut,[...updates,insert].join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
