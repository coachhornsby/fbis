/**
 * Soccer-FBIS-v1 independent research model.
 * Team goal form only; no market or Action input.
 */
import { loadTeamForm } from "./store.js";

export const SOCCER_FBIS_ID="SOCCER-FBIS-v1";
export const SOCCER_FBIS_VERSION="research-v1-form";
export const SOCCER_LEAGUES=Object.freeze(["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1"]);
const CFG=Object.freeze({leagueGoals:1.42,homeGoalAdj:0.18,priorGames:10,minGoals:0.25,maxGoals:3.75});
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const round2=v=>Math.round(Number(v)*100)/100;
function row(map,t){
  if(!map?.get||!t)return null;
  for(const k of [
    t.espnId!=null?`id:${t.espnId}`:null,
    t.abbr?`abbr:${String(t.abbr).toUpperCase()}`:null,
    t.name?`name:${String(t.name).toLowerCase()}`:null,
  ].filter(Boolean)){const x=map.get(k);if(x)return x;}
  return null;
}
function rates(r){
  const g=num(r?.games)||0,pf=num(r?.pointsFor??r?.points_for),pa=num(r?.pointsAgainst??r?.points_against);
  return g&&pf!=null&&pa!=null?{games:g,gf:pf/g,ga:pa/g}:null;
}
function blend(a,b,n,w=CFG.priorGames){
  if(b==null)return a;if(a==null)return b;const x=(Number(n)||0)/((Number(n)||0)+w);return a*(1-x)+b*x;
}
function poissonPmf(k,lambda){let f=1;for(let i=2;i<=k;i++)f*=i;return Math.exp(-lambda)*lambda**k/f;}
function outcomeProb(home,away){
  let h=0,d=0,a=0;
  for(let x=0;x<=8;x++)for(let y=0;y<=8;y++){const p=poissonPmf(x,home)*poissonPmf(y,away);if(x>y)h+=p;else if(x===y)d+=p;else a+=p;}
  const s=h+d+a||1;return{home:h/s,draw:d/s,away:a/s};
}
export function soccerSeasonYear(date=new Date()){
  const d=date instanceof Date?date:new Date(date),y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
  return m>=7?y:y-1;
}
export function projectSoccerForm(game,{homePrior=null,awayPrior=null,homeCurrent=null,awayCurrent=null}={}){
  const hp=rates(homePrior),ap=rates(awayPrior),hc=rates(homeCurrent),ac=rates(awayCurrent);
  if(!(hp||hc)||!(ap||ac))return{ok:false,modelId:SOCCER_FBIS_ID,reason:"team-form-evidence-missing",marketInformed:false,canQualify:false};
  const hgf=blend(hp?.gf??CFG.leagueGoals,hc?.gf,hc?.games||0);
  const hga=blend(hp?.ga??CFG.leagueGoals,hc?.ga,hc?.games||0);
  const agf=blend(ap?.gf??CFG.leagueGoals,ac?.gf,ac?.games||0);
  const aga=blend(ap?.ga??CFG.leagueGoals,ac?.ga,ac?.games||0);
  const hfa=game?.neutralSite?0:CFG.homeGoalAdj;
  const home=round2(Math.max(CFG.minGoals,Math.min(CFG.maxGoals,(hgf+aga)/2+hfa)));
  const away=round2(Math.max(CFG.minGoals,Math.min(CFG.maxGoals,(agf+hga)/2)));
  const p=outcomeProb(home,away);
  return{ok:true,modelId:SOCCER_FBIS_ID,modelVersion:SOCCER_FBIS_VERSION,home,away,total:round2(home+away),margin:round2(home-away),
    pHomeWin:p.home,pDraw:p.draw,pAwayWin:p.away,independent:true,marketInformed:false,maturity:"RESEARCH",canQualify:false,canAuthorize:false,
    provenance:{source:"scoreboard-derived soccer team_form",marketUsed:false,priorGames:CFG.priorGames,hfa}};
}
export async function attachSoccerResearch(games=[],env={}){
  const season=soccerSeasonYear(new Date((games||[])[0]?.start||Date.now()));
  const [prior,current]=await Promise.all([
    loadTeamForm(env,"soccer",season-1).catch(()=>new Map()),
    loadTeamForm(env,"soccer",season).catch(()=>new Map()),
  ]);
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectSoccerForm(game,{homePrior:row(prior,game.home),awayPrior:row(prior,game.away),homeCurrent:row(current,game.home),awayCurrent:row(current,game.away)});
    if(!p.ok){missing++;return{...game,soccerFbis:p,pureProjectionAvailable:false,qualificationBlocked:true,canQualify:false};}
    projected++;
    return{...game,soccerFbis:p,projHomeScore:p.home,projAwayScore:p.away,projectionKind:"FBIS",projectionEngine:SOCCER_FBIS_ID,
      projectionMaturity:"RESEARCH",projectionDisplayLabel:"FBIS SOCCER RESEARCH PROJECTION",pureProjectionAvailable:true,qualificationBlocked:true,
      canQualify:false,canAuthorizeWager:false,publicationStatus:"RESEARCH_PUBLISHABLE",bettingAuthority:"NOT_ELIGIBLE",modelVersion:SOCCER_FBIS_VERSION,
      model:{...(game.model||{}),projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,pHomeFinal:p.pHomeWin,pHome:p.pHomeWin,
        pDraw:p.pDraw,pAway:p.pAwayWin,projectionKind:"FBIS",maturity:"RESEARCH",canQualify:false,canAuthorize:false,canShowCalibratedEv:false,
        recipe:{engine:SOCCER_FBIS_ID,version:SOCCER_FBIS_VERSION,family:"research",steps:["scoreboard goal-form blend","Poisson 1X2 distribution","Research only — no wager authority"]}},
      researchProjection:{modelId:SOCCER_FBIS_ID,modelVersion:SOCCER_FBIS_VERSION,maturity:"RESEARCH",home:p.home,away:p.away,total:p.total,margin:p.margin,
        pHome:p.pHomeWin,pDraw:p.pDraw,pAway:p.pAwayWin,note:"Independent scoreboard-derived soccer projection.",canQualify:false,canAuthorize:false},
      challengers:{...(game.challengers||{}),[SOCCER_FBIS_ID]:p}};
  });
  return{games:next,meta:{modelId:SOCCER_FBIS_ID,version:SOCCER_FBIS_VERSION,season,projected,missing,marketInformed:false,canQualify:false,canAuthorize:false,maturity:"RESEARCH"}};
}
