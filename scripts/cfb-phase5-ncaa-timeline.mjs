#!/usr/bin/env node
/** Independent NCAA timeline coverage quality: four periods + terminal official score.
 * Does not assume every possession change is proven by this provider's data.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
export function certifyTimeline(doc,official,gameId){
 const periods=doc?.data?.playbyplay?.periods;
 if(!Array.isArray(periods))return {game_id:String(gameId),periods:0,playCount:0,officialTimelineConsistent:false,issues:['MISSING_OFFICIAL_PBP']};
 const nums=periods.map(p=>Number(p.periodNumber));
 const segments=periods.flatMap(p=>p.playbyplayStats||[]);
 const plays=segments.flatMap(s=>s.plays||[]);
 const last=plays.at(-1),issues=[];
 if(![1,2,3,4].every(n=>nums.includes(n)))issues.push('REGULATION_PERIOD_MISSING');
 if(new Set(nums).size!==nums.length)issues.push('DUPLICATE_PERIOD_IDENTIFIER');
 if(!plays.length)issues.push('NO_OFFICIAL_PLAYS');
 if(official?.independent_ncaa_verified!==true)issues.push('OFFICIAL_FINAL_UNVERIFIED');
 if(Number(last?.homeScore)!==Number(official?.ncaa_home)||Number(last?.visitorScore)!==Number(official?.ncaa_away))issues.push('OFFICIAL_PBP_TERMINAL_SCORE_MISMATCH');
 return {game_id:String(gameId),periods:nums.length,periodNumbers:nums,playCount:plays.length,
  terminalScore:{home:last?.homeScore??null,away:last?.visitorScore??null},
  independentlyOfficialSource:true,officialTimelineConsistent:issues.length===0,
  allPossessionBoundariesIndependentlyCertified:false,
  issues,canAuthorizeWager:false,canPromoteModel:false};
}
if(process.argv[1]?.endsWith('cfb-phase5-ncaa-timeline.mjs')){
 const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
 const finals=JSON.parse(readFileSync(join(root,'ncaa-official-reconciliation-summary.json'),'utf8'));
 const receipts=[];
 for(const f of finals.rows){
  const dir=join(root,'week'+String(f.week).padStart(2,'0'),String(f.game_id));
  const json=JSON.parse(readFileSync(join(dir,'ncaa-official-pbp-raw.json'),'utf8'));
  const r=certifyTimeline(json,f,f.game_id);
  receipts.push(r);writeFileSync(join(dir,'ncaa-official-pbp-quality.json'),JSON.stringify(r,null,2));
 }
 const result={schema:'fbis.cfb.phase5.ncaa_timeline_quality.v1',games:receipts.length,
  officialPbpGameCoverage:receipts.filter(x=>x.playCount>0).length,
  completePeriodAndTerminalScore:receipts.filter(x=>x.officialTimelineConsistent).length,
  officialPlayCount:receipts.reduce((s,x)=>s+x.playCount,0),
  independentPossessionBoundariesComplete:0,
  explicitIssues:receipts.filter(x=>x.issues.length).map(x=>({game_id:x.game_id,issues:x.issues})),
  qualification:'OFFICIAL_PLAY_TIMELINE_STRUCTURAL_ONLY',wagerAuthority:false,modelPromotion:false,
  rows:receipts};
 writeFileSync(join(root,'phase5-ncaa-official-timeline-quality.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({games:result.games,officialTimelineConsistent:result.completePeriodAndTerminalScore,plays:result.officialPlayCount,possessionsCertified:0}));
}
