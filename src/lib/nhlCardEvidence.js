/**
 * NHL card evidence contract. Presentation-only; never upgrades projection,
 * market, probability, calibration, or wagering authority.
 */
const numeric = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const pct = value => numeric(value) == null ? null : `${(Number(value)*100).toFixed(1)}%`;
const american = value => { const n=numeric(value); return n==null ? "—" : n>0 ? `+${Math.round(n)}` : String(Math.round(n)); };
const text = value => value == null || value === "" ? null : String(value);
const goalieState = value => {
  const s=String(value||"").toUpperCase();
  if(s==="CONFIRMED_STARTER"||s==="CONFIRMED")return "CONFIRMED";
  if(s==="EXPECTED_G1"||s==="PROJECTED")return "PROJECTED";
  if(s==="PRIOR_GAME_STARTER_UNVERIFIED")return "PRIOR GAME ONLY";
  return "UNVERIFIED";
};
function projectedGoalie(game,side) {
  const p=game?.nhlProV2?.ok ? game.nhlProV2 : null;
  const m=p?.layers?.goalie?.[side] || null;
  const evidence=game?.nhlStarterEvidence?.[side] ||
    game?.nhlGoalieProbabilityShadow?.starterEvidence?.[side] ||
    game?.nhlUnifiedMoneylineShadow?.components?.goalieShadow?.starterEvidence?.[side] || null;
  const state=goalieState(evidence?.state);
  // Event-bound starter evidence wins for DISPLAY only; it never changes model math.
  const named=(state!=="UNVERIFIED" ? text(evidence?.name) : null);
  const n=named || text(m?.name) || (m?.goalieId!=null ? `ID ${m.goalieId}` : null);
  const stateNote=evidence?.lineupMatched===false ? "MODEL / STARTER MISMATCH" :
    state === "PRIOR GAME ONLY" ? "PREVIOUS GAME · NOT CONFIRMED TODAY" :
    state === "UNVERIFIED" ? "STARTER NOT CONFIRMED" : state;
  return {name:n||"No sourced goalie",state:stateNote,evidenceAt:evidence?.evidenceAt||null,
    source:evidence?.source||m?.source||null,modeled:Boolean(m?.name||m?.goalieId),sourced:Boolean(named),priorGameStarter:Boolean(evidence?.priorGameStarter)};
}
function recordedMoneyline(game) {
  const start=Date.parse(game?.start||"");
  const items=(Array.isArray(game?.marketLineHistory)?game.marketLineHistory:[])
    .filter(r=>String(r.market||"").toLowerCase()==="ml"||String(r.market||"").toLowerCase()==="moneyline")
    .map(r=>({...r,ms:Date.parse(r.collectedAt||"")}))
    .filter(r=>Number.isFinite(r.ms)&&(!Number.isFinite(start)||r.ms<start)&&numeric(r.americanPrice)!=null)
    .sort((a,b)=>b.ms-a.ms);
  const latest=items[0];if(!latest)return null;
  const same=items.filter(r=>r.collectedAt===latest.collectedAt&&r.sportsbook===latest.sportsbook);
  const bySide=side=>same.find(r=>String(r.selection||"").toLowerCase()===side)?.americanPrice??null;
  return {book:text(latest.sportsbook)||"Recorded book",observedAt:latest.collectedAt,home:bySide("home"),away:bySide("away"),role:"RECORDED_PREGAME_SNAPSHOT"};
}
export function buildNhlCardEvidence(game, vm) {
  if(String(game?.sport||vm?.sport||"").toLowerCase()!=="nhl")return null;
  const p=game?.nhlProV2?.ok===true?game.nhlProV2:null;
  const home=String(vm?.home?.abbr||game?.home?.abbr||"HOME").toUpperCase();
  const away=String(vm?.away?.abbr||game?.away?.abbr||"AWAY").toUpperCase();
  const teamMatch=Boolean(p&&String(p.home||"").toUpperCase()===home&&String(p.away||"").toUpperCase()===away);
  const audit=game?.nhlUnifiedMoneylineShadow?.probabilityAudit||null;
  const prob=numeric(p?.probability?.homeWinIncludingOt);
  const inverse=numeric(p?.probability?.awayWinIncludingOt);
  const probabilityValid=Boolean(teamMatch&&prob!=null&&inverse!=null&&prob>0&&prob<1&&Math.abs(prob+inverse-1)<0.002&&audit?.ok!==false);
  const probabilityIntegrity=audit?.ok===false?"INTEGRITY HOLD":audit?.ok===true?"PIT-AUDITED RESEARCH":"PIT NOT VERIFIED";
  const market=vm?.market||{};
  const currentML=market.homeMl!=null||market.awayMl!=null;
  const snapshot=!currentML?recordedMoneyline(game):null;
  const book=market.book||"Unspecified";
  const role=market.role==="EXECUTION_MARKET"?"EXECUTION QUOTE":market.role==="CONSENSUS_MARKET"?"OBSERVED CONSENSUS":market.role==="REFERENCE_MARKET"?"REFERENCE ONLY":"NO CURRENT MARKET";
  const marketInfo=currentML?{
    home:american(market.homeMl),away:american(market.awayMl),
    book,role,observedAt:game?.market?.asOf||game?.market?.observedAt||game?.market?.execution?.sourceObservedAt||game?.market?.consensus?.sourceObservedAt||null
  }:snapshot?{
    home:american(snapshot.home),away:american(snapshot.away),
    book:snapshot.book,role:"ARCHIVED SNAPSHOT · NOT CURRENT",observedAt:snapshot.observedAt
  }:{home:"—",away:"—",book:null,role:"NO TIMESTAMPED MONEYLINE QUOTE",observedAt:null};
  const goalies={away:projectedGoalie(game,"away"),home:projectedGoalie(game,"home")};
  const matchups=Array.isArray(game?.matchupFactors)?game.matchupFactors:[];
  const coverage={
    projection:teamMatch?"AVAILABLE":"UNAVAILABLE",
    moneyline:currentML?"AVAILABLE":snapshot?"HISTORICAL_ONLY":"UNAVAILABLE",
    goalies:goalies.away.state==="CONFIRMED"&&goalies.home.state==="CONFIRMED"?"CONFIRMED":
      goalies.away.state==="PROJECTED"&&goalies.home.state==="PROJECTED"?"PROJECTED":
      goalies.away.sourced||goalies.home.sourced||goalies.away.modeled||goalies.home.modeled?"CONTEXT_ONLY":"UNAVAILABLE",
    matchup:matchups.some(m=>m?.available!==false)?"AVAILABLE":"UNAVAILABLE",
    action:vm?.action?.available?"AVAILABLE":"UNAVAILABLE",
  };
  return {
    available:true, home,away,goalies,coverage,market:marketInfo,
    model:teamMatch?text(p.modelId)||"NHL-PRO-v2":"NO INDEPENDENT NHL MODEL",
    modelVersion:teamMatch?text(p.modelVersion):null,
    researchOnly:true,qualified:false,
    moneyline:{
      integrity:probabilityIntegrity,
      valid:probabilityValid,
      home:probabilityValid?pct(prob):null,
      away:probabilityValid?pct(inverse):null,
      source:"NHL-PRO-v2 · full game including OT/SO · research",
      reason:audit?.ok===false?(audit.reasons||[]).join(", ")||"Probability provenance failed":
        !teamMatch?"No event-bound independent score/probability":!probabilityValid?"Missing or inconsistent paired moneyline probabilities":
        audit?.ok!==true?"Immutable source/feature cutoff not verified":"No wagering authority",
    },
    notes:[
      !teamMatch?"Independent NHL projection unavailable":null,
      !probabilityValid?"Moneyline probability withheld pending integrity":null,
      coverage.moneyline==="UNAVAILABLE"?"No current or timestamped stored moneyline quote":null,
      coverage.goalies!=="CONFIRMED"?"Both current-game starters are not source-confirmed":null,
      coverage.matchup==="UNAVAILABLE"?"No source-backed NHL matchup factors":null,
    ].filter(Boolean)
  };
}
