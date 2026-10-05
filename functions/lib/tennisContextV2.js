/**
 * TENNIS-FBIS-v2 context layer.
 * Optional context is explicit and null-safe. Missing data never becomes zero.
 * Research-only: no source in this file can authorize a wager.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

export const TENNIS_CONTEXT_VERSION="v2-context-1";

export function normalizeTennisContext(raw={}){
  const indoor=raw.indoor==null?null:Boolean(raw.indoor);
  const altitudeM=finite(raw.altitudeM);
  const courtSpeedIndex=finite(raw.courtSpeedIndex);
  const hoursSinceLastMatch=finite(raw.hoursSinceLastMatch);
  const minutesLast3Days=finite(raw.minutesLast3Days);
  const minutesLast7Days=finite(raw.minutesLast7Days);
  const gamesLast3Days=finite(raw.gamesLast3Days);
  const gamesLast7Days=finite(raw.gamesLast7Days);
  const setsLast3Days=finite(raw.setsLast3Days);
  const setsLast7Days=finite(raw.setsLast7Days);
  const travelKm7Days=finite(raw.travelKm7Days);
  const timeZonesCrossed7Days=finite(raw.timeZonesCrossed7Days);
  const daysSinceRetirementOrMto=finite(raw.daysSinceRetirementOrMto);
  const daysSinceInjuryReturn=finite(raw.daysSinceInjuryReturn);
  const age=finite(raw.age);
  const injuryStatus=raw.injuryStatus?String(raw.injuryStatus).toLowerCase():null;
  const recentServeSpeedDeltaKph=finite(raw.recentServeSpeedDeltaKph);
  const returnStyleScore=finite(raw.returnStyleScore);
  const serveStyleScore=finite(raw.serveStyleScore);
  return {
    indoor,altitudeM,courtSpeedIndex,hoursSinceLastMatch,minutesLast3Days,minutesLast7Days,
    gamesLast3Days,gamesLast7Days,setsLast3Days,setsLast7Days,
    travelKm7Days,timeZonesCrossed7Days,daysSinceRetirementOrMto,daysSinceInjuryReturn,
    age,injuryStatus,recentServeSpeedDeltaKph,returnStyleScore,serveStyleScore,
    tournamentLevel:raw.tournamentLevel?String(raw.tournamentLevel).toLowerCase():null,
    tournament:raw.tournament?String(raw.tournament):null,
    sourceAsOf:raw.sourceAsOf||null,
  };
}

export function contextCompleteness(ctx={}){
  const keys=["indoor","altitudeM","courtSpeedIndex","hoursSinceLastMatch","minutesLast3Days",
    "minutesLast7Days","gamesLast3Days","gamesLast7Days","setsLast3Days","setsLast7Days",
    "travelKm7Days","timeZonesCrossed7Days","injuryStatus",
    "daysSinceInjuryReturn","recentServeSpeedDeltaKph","returnStyleScore","serveStyleScore"];
  const present=keys.filter(k=>ctx[k]!=null).length;
  return {present,total:keys.length,ratio:present/keys.length};
}

/**
 * Convert context to a conservative serve-point adjustment.
 * Coefficients are research priors, not learned production coefficients.
 * Each component is capped to avoid context swamping the fundamental model.
 */
export function tennisContextServeAdjustment(raw={},opponentRaw={}){
  const c=normalizeTennisContext(raw),o=normalizeTennisContext(opponentRaw);
  const parts={};
  if(c.courtSpeedIndex!=null) parts.courtSpeed=clamp((c.courtSpeedIndex-1)*0.018,-0.018,0.018);
  if(c.indoor===true) parts.indoor=0.004;
  if(c.altitudeM!=null) parts.altitude=clamp(c.altitudeM/2500*0.006,0,0.008);
  if(c.hoursSinceLastMatch!=null && c.hoursSinceLastMatch<30) parts.turnaround=-clamp((30-c.hoursSinceLastMatch)/30*0.008,0,0.008);
  if(c.minutesLast3Days!=null) parts.fatigue3d=-clamp(Math.max(0,c.minutesLast3Days-240)/360*0.010,0,0.010);
  if(c.minutesLast7Days!=null) parts.fatigue7d=-clamp(Math.max(0,c.minutesLast7Days-540)/700*0.006,0,0.006);
  if(c.gamesLast3Days!=null) parts.gamesFatigue3d=-clamp(Math.max(0,c.gamesLast3Days-55)/70*0.008,0,0.008);
  if(c.gamesLast7Days!=null) parts.gamesFatigue7d=-clamp(Math.max(0,c.gamesLast7Days-110)/130*0.005,0,0.005);
  if(c.setsLast3Days!=null) parts.setsFatigue3d=-clamp(Math.max(0,c.setsLast3Days-6)/8*0.006,0,0.006);
  if(c.setsLast7Days!=null) parts.setsFatigue7d=-clamp(Math.max(0,c.setsLast7Days-12)/16*0.004,0,0.004);
  if(c.travelKm7Days!=null) parts.travel=-clamp(Math.max(0,c.travelKm7Days-2500)/9000*0.005,0,0.005);
  if(c.timeZonesCrossed7Days!=null) parts.timezones=-clamp(Math.max(0,c.timeZonesCrossed7Days-2)/8*0.005,0,0.005);
  if(c.recentServeSpeedDeltaKph!=null) parts.serveSpeed=clamp(c.recentServeSpeedDeltaKph/25*0.010,-0.010,0.010);
  if(c.injuryStatus){
    const penalty={questionable:-0.008,limited:-0.010,returning:-0.007,injured:-0.018}[c.injuryStatus];
    if(penalty!=null) parts.injury=penalty;
  }
  if(c.daysSinceInjuryReturn!=null && c.daysSinceInjuryReturn<21) parts.returnFromInjury=-clamp((21-c.daysSinceInjuryReturn)/21*0.008,0,0.008);
  if(c.daysSinceRetirementOrMto!=null && c.daysSinceRetirementOrMto<14) parts.recentPhysicalIssue=-clamp((14-c.daysSinceRetirementOrMto)/14*0.006,0,0.006);
  if(c.serveStyleScore!=null && o.returnStyleScore!=null){
    parts.style=clamp((c.serveStyleScore-o.returnStyleScore)*0.004,-0.008,0.008);
  }
  const total=clamp(Object.values(parts).reduce((s,x)=>s+x,0),-0.03,0.03);
  return {total,parts,context:c,opponentContext:o,completeness:contextCompleteness(c)};
}

export function contextualizeMatchupProfiles(profiles=[],contexts=[]){
  if(!Array.isArray(profiles)||profiles.length!==2)return profiles;
  return profiles.map((p,i)=>{
    const adj=tennisContextServeAdjustment(contexts[i]||{},contexts[1-i]||{});
    const base=finite(p.servePointWinPct??p.matchupServePointWinPct)??0.62;
    return {
      ...p,
      servePointWinPct:clamp(base+adj.total,.44,.82),
      matchupServePointWinPct:clamp(base+adj.total,.44,.82),
      contextAdjustment:adj,
    };
  });
}

export function deriveCourtSpeedIndex(rows=[],{tour="atp"}={}){
  const valid=rows.filter(r=>finite(r.holdPct)!=null||finite(r.aceRate)!=null||finite(r.servePointWin)!=null);
  if(!valid.length)return null;
  const base=tour==="wta"?{hold:.72,ace:.045,spw:.59}:{hold:.79,ace:.075,spw:.64};
  const vals=valid.map(r=>{
    const hold=finite(r.holdPct),ace=finite(r.aceRate),spw=finite(r.servePointWin);
    const components=[];
    if(hold!=null)components.push((hold-base.hold)/0.08);
    if(ace!=null)components.push((ace-base.ace)/0.04);
    if(spw!=null)components.push((spw-base.spw)/0.05);
    return components.length?components.reduce((a,b)=>a+b,0)/components.length:null;
  }).filter(Number.isFinite);
  return vals.length?clamp(1+vals.reduce((a,b)=>a+b,0)/vals.length*0.12,.78,1.22):null;
}
