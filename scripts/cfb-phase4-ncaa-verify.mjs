#!/usr/bin/env node
/** Fail-closed independent NCAA.com final-score corroboration for 226 CFB historical games.
 * NCAA source: official sdataprod.ncaa.com persisted-query scoreboard.
 * ESPN raw summaries remain separate; no modification of frozen model or production grades.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
const ROOT=process.env.CFB_EVIDENCE_OUT||"artifacts/cfb-2026-weeks05-08";
const ROSTER=JSON.parse(readFileSync("data/cfb/2026/weeks05-08-game-roster.json","utf8"));
if(ROSTER.length!==226)throw Error("EXPECTED_226_SOURCE_GAMES");
const expansions={st:"state",fla:"florida",mich:"michigan",tenn:"tennessee",cal:"california",car:"carolina",ga:"georgia",w:"western",e:"eastern",n:"northern",s:"southern",ill:"illinois",ariz:"arizona",miss:"mississippi",dak:"dakota",okla:"oklahoma",ala:"alabama"};
const canonicalAliases={usc:"southerncalifornia",miami:"miamifl",army:"armywestpoint",northernillinois:"niu",floridainternational:"fiu",ulmonroe:"louisianamonroe",louisianamonroe:"louisianamonroe"};
const normalize=s=>{
 const ascii=String(s||"").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();
 const expanded=ascii.replace(/&/g,"and").split(/[^a-z0-9]+/).filter(Boolean).filter(x=>x!=="university").map(x=>expansions[x]||x).join("");
 return canonicalAliases[expanded]||expanded;
};
const queryHash="7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";
const sourceUrl=week=>{const u=new URL("https://sdataprod.ncaa.com/");u.searchParams.set("extensions",JSON.stringify({persistedQuery:{version:1,sha256Hash:queryHash}}));u.searchParams.set("variables",JSON.stringify({sportCode:"MFB",division:11,seasonYear:2026,week}));return u.toString();};
export function compare(g,report,contests,claimedIds=new Set()){
 const url=`https://www.ncaa.com/scoreboard/football/fbs/2026/${g.week}/all-conf`;
 const home=normalize(g.home_team_source),away=normalize(g.away_team_source);
 const candidates=contests.filter(c=>{
  if(claimedIds.has(String(c.contestId)))return false;
  const a=c.teams?.find(t=>!t.isHome),h=c.teams?.find(t=>t.isHome);
  if(!a||!h||c.gameState!=="F")return false;
  const hnames=[h.nameShort,h.seoname,h.name6Char].map(normalize),anames=[a.nameShort,a.seoname,a.name6Char].map(normalize);
  return hnames.includes(home)&&anames.includes(away);
 });
 const candidate=candidates.length===1?candidates[0]:null;
 const h=candidate?.teams?.find(t=>t.isHome),a=candidate?.teams?.find(t=>!t.isHome);
 const good=candidate&&Number.isFinite(Number(h.score))&&Number.isFinite(Number(a.score))&&
   Number(h.score)===Number(report.secondary_home_score)&&Number(a.score)===Number(report.secondary_away_score);
 return {game_id:String(g.game_id),week:g.week,ncaa_scoreboard_url:url,ncaa_contest_id:candidate?.contestId??null,
  independent_ncaa_verified:!!good,score_agreement:!!good,
  status:candidates.length>1?"AMBIGUOUS_NCAA_IDENTITY":!candidate?"NO_UNIQUE_NCAA_MATCH":good?"NCAA_VERIFIED":"FINAL_SCORE_CONFLICT",
  secondary_espn_home:report.secondary_home_score,secondary_espn_away:report.secondary_away_score,
  ncaa_home:h?.score??null,ncaa_away:a?.score??null,
  original_projection_unchanged:true,wager_authority:false};
}
if(process.argv[1]?.endsWith("cfb-phase4-ncaa-verify.mjs")){
 mkdirSync(ROOT,{recursive:true});
 const sources=new Map(),errors=[];
 for(const w of [5,6,7,8]){
  try{const res=await fetch(sourceUrl(w),{headers:{"User-Agent":"FBIS-Independent-CFB-Score-Research/1.0"},signal:AbortSignal.timeout(20000)});
   if(!res.ok)throw Error("HTTP_"+res.status);
   const json=await res.json();if(json.errors?.length||!Array.isArray(json.data?.contests))throw Error("INVALID_NCAA_RESPONSE");
   sources.set(w,json.data.contests);
   writeFileSync(join(ROOT,`ncaa-week${w}-raw.json`),JSON.stringify(json,null,2));
  }catch(e){errors.push({week:w,error:String(e)});sources.set(w,[]);}
 }
 const used=new Set(),rows=[];
 for(const g of ROSTER){
  const file=join(ROOT,`week${String(g.week).padStart(2,"0")}`,String(g.game_id),"evidence-receipt.json");
  const report=JSON.parse(readFileSync(file,"utf8"));
  let r=compare(g,report,sources.get(Number(g.week))||[],used);
  if(r.independent_ncaa_verified)used.add(String(r.ncaa_contest_id));
  rows.push(r);
  writeFileSync(join(ROOT,`week${String(g.week).padStart(2,"0")}`,String(g.game_id),"ncaa-official-reconciliation.json"),JSON.stringify(r,null,2));
 }
 const summary={schema:"fbis.cfb.phase4.ncaa_independent.v1",games:rows.length,ncaaVerified:rows.filter(r=>r.independent_ncaa_verified).length,
  conflicts:rows.filter(r=>r.status==="FINAL_SCORE_CONFLICT").length,unmatched:rows.filter(r=>r.status==="NO_UNIQUE_NCAA_MATCH").length,
  unavailableWeeks:errors,modelPromotion:false,wagerAuthority:false,rows};
 writeFileSync(join(ROOT,"ncaa-official-reconciliation-summary.json"),JSON.stringify(summary,null,2));
 console.log(JSON.stringify({games:summary.games,ncaaVerified:summary.ncaaVerified,conflicts:summary.conflicts,unmatched:summary.unmatched,unavailableWeeks:errors.length}));
}
