#!/usr/bin/env node
/** Independently retrieve NCAA official game PBP by verified NCAA contest IDs.
 * Does NOT infer complete possession boundaries from partial response.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const ROOT=process.env.CFB_EVIDENCE_OUT||"artifacts/cfb-2026-weeks05-08";
const FOOTBALL="47928f2cabc7a164f0de0ed535a623bdf5a852cce7c30d6a6972a38609ba46a2";
const GENERIC="57f922d56d60d88326b62202b3d88e8cd3cfb6687931bc0b5b3dfab089b84faa";
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function examine(doc){
 const periods=doc?.data?.playbyplay?.periods;
 if(!Array.isArray(periods))return {valid:false,periods:0,plays:0};
 const plays=periods.reduce((sum,p)=>sum+(Array.isArray(p.playbyplayStats)?p.playbyplayStats.length:0),0);
 return {valid:plays>0,periods:periods.length,plays};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
const official=JSON.parse(readFileSync(join(ROOT,'ncaa-official-reconciliation-summary.json'),'utf8'));
if(official.ncaaVerified!==226||official.rows?.length!==226)throw Error('INDEPENDENT_226_NCAA_FINALS_REQUIRED');
const roster=JSON.parse(readFileSync('data/cfb/2026/weeks05-08-game-roster.json','utf8'));
const season=new Map(roster.map(x=>[String(x.game_id),x]));
const pathFor=(g)=>join(ROOT,'week'+String(g.week).padStart(2,'0'),String(g.game_id));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function getNCAA(id,hash){
 const url=new URL('https://sdataprod.ncaa.com/');
 url.searchParams.set('extensions',JSON.stringify({persistedQuery:{version:1,sha256Hash:hash}}));
 url.searchParams.set('variables',JSON.stringify({contestId:String(id),staticTestEnv:null}));
 const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('NCAA_PBP_HTTP_'+r.status);
 return r.json();
}
const rows=[];
async function processOne(r){
 const g=season.get(String(r.game_id));
 if(!g||!r.independent_ncaa_verified||!r.ncaa_contest_id)throw Error('MISSING_NCAA_IDENTITY_'+r.game_id);
 let selected=null,analysis=null,usedHash=null,error=null;
 for(const h of [FOOTBALL,GENERIC]){
  for(let retry=0;retry<2;retry++){
   try{
    const data=await getNCAA(r.ncaa_contest_id,h),test=examine(data);
    if(test.valid){selected=data;analysis=test;usedHash=h;break;}
    error='NCAA_PBP_EMPTY_OR_INVALID';
   }catch(e){error=String(e);await pause(250*(retry+1));}
  }
  if(selected)break;
 }
 const receipt={game_id:String(r.game_id),week:g.week,ncaa_contest_id:r.ncaa_contest_id,
  official_ncaa_final_verified:true,source:'NCAA_SDATAPROD_OFFICIAL',ncaaPlayCount:analysis?.plays||0,
  ncaaPeriods:analysis?.periods||0,providerIndependentFromESPN:!!selected,
  independentPbpSourceAvailable:!!selected,completePossessionHistoryVerified:false,
  completePbpEventsVerified:false,sourceError:selected?null:error,
  unchangedChampion:true,canAuthorizeWager:false};
 const dir=pathFor(g);
 if(selected)writeFileSync(join(dir,'ncaa-official-pbp-raw.json'),JSON.stringify(selected));
 writeFileSync(join(dir,'ncaa-playbyplay-coverage-receipt.json'),JSON.stringify(receipt,null,2));
 return receipt;
}
for(let i=0;i<official.rows.length;i+=5){
 const batch=await Promise.all(official.rows.slice(i,i+5).map(processOne));
 rows.push(...batch);
 if((i+5)%50===0)console.log('NCAA_PBP_PROCESSED',Math.min(i+5,official.rows.length));
 await pause(80);
}
const report={schema:'fbis.cfb.phase5.ncaa_pbp.v1',games:rows.length,
 independentlyAvailablePbp:rows.filter(r=>r.independentPbpSourceAvailable).length,
 totalNcaaPlays:rows.reduce((s,r)=>s+r.ncaaPlayCount,0),
 sourceFailures:rows.filter(r=>!r.independentPbpSourceAvailable).map(x=>({game_id:x.game_id,sourceError:x.sourceError})),
 independentPossessionCompletenessConfirmed:0,modelPromotion:false,wagerAuthority:false,rows};
writeFileSync(join(ROOT,'phase5-ncaa-independent-pbp-coverage.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({games:report.games,independentPbpSources:report.independentlyAvailablePbp,totalPlays:report.totalNcaaPlays,failures:report.sourceFailures.length}));

}
