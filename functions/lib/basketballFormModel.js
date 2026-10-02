/**
 * Independent basketball team-form research model for NBA/WNBA.
 * Uses only durable scoreboard-derived points for/against. No sportsbook,
 * Action, consensus, or line-derived input enters the projection.
 */
import { loadTeamForm } from "./store.js";
import { pGreater } from "./metrics.js";

export const BASKETBALL_FORM_MODELS=Object.freeze({
  nba:{modelId:"NBA-FBIS-FORM-v1",version:"research-v1",leaguePpg:114.5,hfa:2.5,priorGames:12,marginSigma:12.0,totalSigma:15.0,minScore:85,maxScore:145},
  wnba:{modelId:"WNBA-FBIS-v1",version:"research-v1-form",leaguePpg:82.0,hfa:2.0,priorGames:10,marginSigma:10.5,totalSigma:12.5,minScore:58,maxScore:108},
});
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const round1=v=>Math.round(Number(v)*10)/10;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function basketballSeasonYear(sport,date=new Date()){
  const d=date instanceof Date?date:new Date(date);
  const y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
  return sport==="nba"?(m>=7?y:y-1):y;
}
function espnIdFromCanonical(canonicalId){
  const m=String(canonicalId||"").match(/^[a-z]+-(\d+)$/i); return m?m[1]:null;
}
function formRow(map,team){
  if(!map?.get||!team) return null;
  const cid=espnIdFromCanonical(team.canonicalId||team.id);
  for(const k of [
    team.espnId!=null?`id:${team.espnId}`:null,
    cid?`id:${cid}`:null,
    team.abbr?`abbr:${String(team.abbr).toUpperCase()}`:null,
    team.name?`name:${String(team.name).toLowerCase()}`:null,
  ].filter(Boolean)){
    const hit=map.get(k); if(hit) return hit;
  }
  return null;
}
function rates(row){
  const games=num(row?.games)||0,pf=num(row?.pointsFor??row?.points_for),pa=num(row?.pointsAgainst??row?.points_against);
  if(!games||pf==null||pa==null) return null;
  return {games,off:pf/games,def:pa/games};
}
function blend(prior,current,n,w){
  if(current==null) return prior;
  if(prior==null) return current;
  const x=Math.max(0,Number(n)||0)/(Math.max(0,Number(n)||0)+w);
  return prior*(1-x)+current*x;
}
export function projectBasketballForm(sport,game,{homePrior=null,awayPrior=null,homeCurrent=null,awayCurrent=null}={}){
  const cfg=BASKETBALL_FORM_MODELS[sport];
  if(!cfg) return {ok:false,reason:"unsupported-basketball-sport"};
  const hp=rates(homePrior),ap=rates(awayPrior),hc=rates(homeCurrent),ac=rates(awayCurrent);
  if(!(hp||hc)||!(ap||ac)) return {ok:false,modelId:cfg.modelId,reason:"team-form-evidence-missing",marketInformed:false,canQualify:false};
  const hOff=blend(hp?.off??cfg.leaguePpg,hc?.off,hc?.games||0,cfg.priorGames);
  const hDef=blend(hp?.def??cfg.leaguePpg,hc?.def,hc?.games||0,cfg.priorGames);
  const aOff=blend(ap?.off??cfg.leaguePpg,ac?.off,ac?.games||0,cfg.priorGames);
  const aDef=blend(ap?.def??cfg.leaguePpg,ac?.def,ac?.games||0,cfg.priorGames);
  const hfa=game?.neutralSite?0:cfg.hfa;
  const home=round1(clamp((hOff+aDef)/2+hfa/2,cfg.minScore,cfg.maxScore));
  const away=round1(clamp((aOff+hDef)/2-hfa/2,cfg.minScore,cfg.maxScore));
  const margin=round1(home-away),total=round1(home+away);
  return {
    ok:true,modelId:cfg.modelId,modelVersion:cfg.version,home,away,margin,total,
    pHomeWin:pGreater(margin,0,cfg.marginSigma),sigmaMargin:cfg.marginSigma,sigmaTotal:cfg.totalSigma,
    independent:true,marketInformed:false,maturity:"RESEARCH",canQualify:false,canAuthorize:false,
    decomposition:{
      home:{offense:round1(hOff),defenseAllowed:round1(hDef)},
      away:{offense:round1(aOff),defenseAllowed:round1(aDef)},
      matchup:{
        homeExpected:round1((hOff+aDef)/2),
        awayExpected:round1((aOff+hDef)/2),
        hfa:round1(hfa),
      },
    },
    provenance:{source:"scoreboard-derived team_form",priorGames:cfg.priorGames,hfa,marketUsed:false,
      evidence:{homePrior:hp?.games||0,awayPrior:ap?.games||0,homeCurrent:hc?.games||0,awayCurrent:ac?.games||0}}
  };
}
export async function attachBasketballFormResearch(games=[],env={},sport="nba"){
  const cfg=BASKETBALL_FORM_MODELS[sport]; if(!cfg) return {games,meta:{ok:false,reason:"unsupported-sport"}};
  const season=basketballSeasonYear(sport,new Date((games||[])[0]?.start||Date.now()));
  const [prior,current]=await Promise.all([
    loadTeamForm(env,sport,season-1).catch(()=>new Map()),
    loadTeamForm(env,sport,season).catch(()=>new Map()),
  ]);
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectBasketballForm(sport,game,{
      homePrior:formRow(prior,game.home),awayPrior:formRow(prior,game.away),
      homeCurrent:formRow(current,game.home),awayCurrent:formRow(current,game.away),
    });
    if(p.ok) projected++; else missing++;
    if(!p.ok) return {...game,basketballForm:p};
    const priorKind=String(game.projectionKind||game.model?.projectionKind||"").toUpperCase();
    const marketProjHome=priorKind.includes("IMPLIED")?(game.projHomeScore??game.model?.projHome??null):(game.marketProjHome??game.model?.marketProjHome??null);
    const marketProjAway=priorKind.includes("IMPLIED")?(game.projAwayScore??game.model?.projAway??null):(game.marketProjAway??game.model?.marketProjAway??null);
    return {
      ...game,basketballForm:p,projHomeScore:p.home,projAwayScore:p.away,marketProjHome,marketProjAway,
      projectionKind:"FBIS",projectionEngine:cfg.modelId,projectionMaturity:"RESEARCH",
      projectionDisplayLabel:`${sport.toUpperCase()} FBIS RESEARCH PROJECTION`,
      pureProjectionAvailable:true,qualificationBlocked:true,canQualify:false,canAuthorizeWager:false,
      publicationStatus:"RESEARCH_PUBLISHABLE",bettingAuthority:"NOT_ELIGIBLE",modelVersion:cfg.version,
      model:{...(game.model||{}),projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,
        pHomeFinal:p.pHomeWin,pHome:p.pHomeWin,projectionKind:"FBIS",marketProjHome,marketProjAway,
        maturity:"RESEARCH",canQualify:false,canAuthorize:false,canShowCalibratedEv:false,
        recipe:{engine:cfg.modelId,version:cfg.version,family:"research",steps:["scoreboard team-form prior/current blend","independent score allocation","Research only — no wager authority"]}},
      researchProjection:{modelId:cfg.modelId,modelVersion:cfg.version,maturity:"RESEARCH",home:p.home,away:p.away,margin:p.margin,total:p.total,
        note:"Independent scoreboard-derived team-form research projection. No sportsbook or Action inputs.",canQualify:false,canAuthorize:false},
      challengers:{...(game.challengers||{}),[cfg.modelId]:p},
    };
  });
  return {games:next,meta:{sport,modelId:cfg.modelId,version:cfg.version,season,projected,missing,independent:true,marketInformed:false,canQualify:false,canAuthorize:false,maturity:"RESEARCH"}};
}
