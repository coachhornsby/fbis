export const TENNIS_REQUIRED_SERVE_COLUMNS=[
  "w_ace","w_df","w_svpt","w_1stIn","w_1stWon","w_2ndWon","w_SvGms","w_bpSaved","w_bpFaced",
  "l_ace","l_df","l_svpt","l_1stIn","l_1stWon","l_2ndWon","l_SvGms","l_bpSaved","l_bpFaced",
];

export const TENNIS_MIN_SERVE_COVERAGE=0.80;
export const TENNIS_THIN_SURFACE_MATCHES=20;
export const TENNIS_MIN_LIVE_SAMPLE_MATCHES=3;

export function parseTennisCsv(text=""){
  if(typeof text!=="string"||!text.trim())return {headers:[],rows:[]};
  const records=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===","){row.push(field);field="";}
      else if(ch==="\n"){row.push(field);records.push(row);row=[];field="";}
      else if(ch!=="\r")field+=ch;
    }
  }
  if(field||row.length){row.push(field);records.push(row);}
  const headers=(records.shift()||[]).map(x=>String(x||"").trim());
  const rows=records.filter(r=>r.some(v=>String(v||"").trim()!==""))
    .map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??""])));
  return {headers,rows};
}

const usableServeRow=r=>TENNIS_REQUIRED_SERVE_COLUMNS.every(k=>String(r?.[k]??"").trim()!=="");

export function auditTennisCsv(text,{source=null,sourceClass=null,year=null,minServeCoverage=TENNIS_MIN_SERVE_COVERAGE}={}){
  const body=String(text??"");
  const trimmed=body.trimStart();
  if(!body.length)return {source,sourceClass,year,bytes:0,rows:0,serveCoverage:0,distinctPlayers:0,levels:[],safe:false,reasons:["empty_file"]};
  if(/^<!doctype html|^<html/i.test(trimmed))return {source,sourceClass,year,bytes:body.length,rows:0,serveCoverage:0,distinctPlayers:0,levels:[],safe:false,reasons:["html_response"]};
  const {headers,rows}=parseTennisCsv(body);
  const missingColumns=TENNIS_REQUIRED_SERVE_COLUMNS.filter(k=>!headers.includes(k));
  const usable=rows.filter(usableServeRow).length;
  const ids=new Set();
  for(const r of rows){
    const w=String(r.winner_id||r.winner_name||"").trim(),l=String(r.loser_id||r.loser_name||"").trim();
    if(w)ids.add(w);if(l)ids.add(l);
  }
  const levels=[...new Set(rows.map(r=>String(r.tourney_level||"").trim()).filter(Boolean))].sort();
  const serveCoverage=rows.length?usable/rows.length:0;
  const reasons=[];
  if(!headers.length)reasons.push("missing_header");
  if(!rows.length)reasons.push("header_only_or_no_rows");
  if(missingColumns.length)reasons.push("required_serve_columns_missing");
  if(rows.length&&serveCoverage<minServeCoverage)reasons.push("serve_coverage_below_threshold");
  return {source,sourceClass,year,bytes:body.length,rows:rows.length,usableServeRows:usable,serveCoverage,distinctPlayers:ids.size,levels,missingColumns,safe:reasons.length===0,reasons};
}

export function assertTennisCoverage(audits,{requiredTourYears=[],requiredChallengerYears=[],maxMissingCurrentTop250Rate=.10}={}){
  const by=(klass,year)=>audits.find(x=>x.sourceClass===klass&&Number(x.year)===Number(year)&&x.safe);
  const missingTour=requiredTourYears.filter(y=>!by("ATP_TOUR",y));
  const missingChallenger=requiredChallengerYears.filter(y=>!by("ATP_CHALLENGER",y));
  if(missingTour.length||missingChallenger.length){
    const e=new Error(`tennis historical coverage incomplete: ATP tour missing [${missingTour.join(",")}], Challenger missing [${missingChallenger.join(",")}]`);
    e.code="TENNIS_SOURCE_COVERAGE_INCOMPLETE";e.missingTour=missingTour;e.missingChallenger=missingChallenger;throw e;
  }
  if(maxMissingCurrentTop250Rate<0||maxMissingCurrentTop250Rate>1)throw new Error("invalid top-250 miss-rate guard");
  return true;
}

const finite=v=>v!=null&&v!==""&&Number.isFinite(Number(v));
export function validateTennisProjectionProfile(p,{surface="hard"}={}){
  const s=String(surface||"hard").toLowerCase().includes("clay")?"clay":String(surface||"hard").toLowerCase().includes("grass")?"grass":"hard";
  const profileType=String(p?._profileType||p?.profileType||"historical").toLowerCase();
  const sample=Number(p?._sampleMatches??p?.surfaceMatches??p?.historyMatches??0);
  const historical=profileType==="historical";
  const live=profileType==="live"||profileType==="cold-start"||profileType==="cold_start";
  const requiredRates=[
    p?.servePointWinPct??p?.servePointWin??p?.servicePointsWonPct,
    p?.returnPointWinPct??p?.returnPointWin??p?.returnPointsWonPct,
    p?.aceRate,
    p?.doubleFaultRate,
  ];
  const elo=historical?(p?.surfaceElo?.[s]??p?.[s+"Elo"]??p?.elo):null;
  const reasons=[];
  if(!p||!String(p.name||p.id||"").trim())reasons.push("player_identity_missing");
  if(requiredRates.some(v=>!finite(v)))reasons.push("serve_return_profile_incomplete");
  if(historical&&!finite(elo))reasons.push("historical_elo_missing");
  if(live&&sample<TENNIS_MIN_LIVE_SAMPLE_MATCHES)reasons.push("live_sample_inadequate");
  if(!historical&&!live)reasons.push("profile_type_unknown");
  return {ok:reasons.length===0,reasons,profileType,sampleMatches:sample,thinSample:sample<TENNIS_THIN_SURFACE_MATCHES,surface:s};
}

export function noValidTennisProjection(detail={}){
  return {
    ok:false,
    status:"NO VALID PROJECTION",
    reason:"INSUFFICIENT PLAYER DATA",
    detail,
    canQualify:false,
    canAuthorizeWager:false,
    decisionEligible:false,
    maturity:"RESEARCH",
  };
}
