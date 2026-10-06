import fit from "../../data/models/nfl-qb-personnel-overlay-v1-fit.json" with { type: "json" };

export const NFL_QB_PERSONNEL_SHADOW_ID = "NFL-QB-PERSONNEL-OVERLAY-v1";
export const NFL_QB_PERSONNEL_GATE = Object.freeze({
  metric:"combined_qb_burden",
  threshold:0.30,
  historicalValidationPassed:true,
  prospectiveValidationPassed:false,
  operatorApprovedForProduction:false,
  lifecycle:"SHADOW",
});

const STATUS_WEIGHT=Object.freeze({
  OUT:1.00, IR:1.00, PUP:1.00, NFI:1.00, SUSPENDED:1.00,
  DOUBTFUL:0.82,
  QUESTIONABLE:0.35,
  DNP_PRACTICE:0.28,
  LIMITED:0.15,
});

const OFFENSE=new Set(["QB","RB","FB","WR","TE","T","OT","G","OG","C","OL"]);
const SKILL=new Set(["RB","FB","WR","TE"]);
const OL=new Set(["T","OT","G","OG","C","OL"]);
const FRONT7=new Set(["DE","DT","DL","NT","LB","ILB","OLB","EDGE"]);
const SECONDARY=new Set(["CB","S","SS","FS","DB"]);

function finite(v){const n=Number(v);return v==null||v===""||!Number.isFinite(n)?null:n}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function normStatus(v){return String(v||"UNKNOWN").trim().toUpperCase().replace(/\s+/g,"_")}
function pos(v){return String(v||"").trim().toUpperCase()}
function playerSnap(p={}){
  return clamp(finite(p.last_known_snap_share??p.lastKnownSnapShare??p.last_game_snap_share??p.lastGameSnapShare??p.expected_snap_share??p.expectedSnapShare)??0,0,1);
}
function statusWeight(p={}){
  const s=normStatus(p.health_state??p.healthState);
  const practice=normStatus(p.practice_state??p.practiceState);
  if(STATUS_WEIGHT[s]!=null)return STATUS_WEIGHT[s];
  if(practice==="DNP"||practice==="DID_NOT_PARTICIPATE"||practice==="DNP_PRACTICE")return STATUS_WEIGHT.DNP_PRACTICE;
  if(practice.includes("LIMIT"))return STATUS_WEIGHT.LIMITED;
  return 0;
}
function samePositionReplacementCapacity(player,players=[]){
  const pp=pos(player.position);
  const self=String(player.player_key??player.playerKey??player.player_id??player.playerId??player.player_name??player.playerName??"");
  return (players||[])
    .filter(p=>pos(p.position)===pp)
    .filter(p=>String(p.player_key??p.playerKey??p.player_id??p.playerId??p.player_name??p.playerName??"")!==self)
    .filter(p=>statusWeight(p)<1)
    .map(playerSnap)
    .sort((a,b)=>b-a)[0]??0;
}
function teamPersonnel(players=[]){
  const out={
    avail_burden:0,out_burden:0,doubtful_burden:0,questionable_burden:0,practice_dnp_burden:0,limited_burden:0,
    qb_burden:0,skill_burden:0,ol_burden:0,front7_burden:0,secondary_burden:0,offense_burden:0,defense_burden:0,
    replacement_gap:0,starter_concern_count:0,max_player_burden:0,injury_count:0,
  };
  for(const p of players||[]){
    const w=statusWeight(p);
    if(w<=0)continue;
    const snap=playerSnap(p), burden=snap*w, pp=pos(p.position);
    out.avail_burden+=burden;
    out.injury_count+=1;
    out.max_player_burden=Math.max(out.max_player_burden,burden);
    if(snap>=0.5)out.starter_concern_count+=1;
    const gap=Math.max(0,snap-samePositionReplacementCapacity(p,players))*w;
    out.replacement_gap+=gap;
    const st=normStatus(p.health_state??p.healthState);
    const practice=normStatus(p.practice_state??p.practiceState);
    if(["OUT","IR","PUP","NFI","SUSPENDED"].includes(st))out.out_burden+=burden;
    else if(st==="DOUBTFUL")out.doubtful_burden+=burden;
    else if(st==="QUESTIONABLE")out.questionable_burden+=burden;
    else if(st==="DNP_PRACTICE"||practice==="DNP"||practice==="DID_NOT_PARTICIPATE"||practice==="DNP_PRACTICE")out.practice_dnp_burden+=burden;
    else if(st==="LIMITED"||practice.includes("LIMIT"))out.limited_burden+=burden;
    if(pp==="QB")out.qb_burden+=burden;
    if(SKILL.has(pp))out.skill_burden+=burden;
    if(OL.has(pp))out.ol_burden+=burden;
    if(FRONT7.has(pp))out.front7_burden+=burden;
    if(SECONDARY.has(pp))out.secondary_burden+=burden;
    if(OFFENSE.has(pp))out.offense_burden+=burden;
    else out.defense_burden+=burden;
  }
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Number(v.toFixed(6))]));
}
function personnelVector(home,away){
  return fit.features.map((name,i)=>{
    const key=name.replace(/^pers_diff_/,"");
    const raw=(finite(home[key])??fit.medians[i])-(finite(away[key])??0);
    const filled=finite(raw)??fit.medians[i];
    return {name,value:filled,standardized:(filled-fit.means[i])/(fit.scales[i]||1),coefficient:fit.coefficients[i]};
  });
}
function correctionFromVector(vector=[]){
  let y=fit.intercept;
  for(const x of vector)y+=x.standardized*x.coefficient;
  return clamp(y,-fit.clipPoints,fit.clipPoints);
}
function normalCdf(z){
  const sign=z<0?-1:1,a=Math.abs(z),t=1/(1+0.3275911*a);
  const poly=(((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t);
  const erf=sign*(1-poly*Math.exp(-a*a));
  return .5*(1+erf);
}

export function qbPersonnelBurdenFromGame(game={}){
  const hp=game?.nflPersistentProfile?.home?.players||[];
  const ap=game?.nflPersistentProfile?.away?.players||[];
  const home=teamPersonnel(hp),away=teamPersonnel(ap);
  return {
    home,away,
    combinedQbBurden:Number((home.qb_burden+away.qb_burden).toFixed(6)),
    homeQbBurden:home.qb_burden,
    awayQbBurden:away.qb_burden,
  };
}

export function buildNflQbPersonnelShadow(game={}){
  const incumbent=game?.nflProShadow||null;
  if(!incumbent?.ok){
    return {ok:false,reason:"incumbent_projection_unavailable",modelId:NFL_QB_PERSONNEL_SHADOW_ID,lifecycle:"SHADOW",canQualify:false,canAuthorizeWager:false};
  }
  const burden=qbPersonnelBurdenFromGame(game);
  const gateFired=burden.combinedQbBurden>=NFL_QB_PERSONNEL_GATE.threshold;
  const vector=personnelVector(burden.home,burden.away);
  const rawCorrection=gateFired?correctionFromVector(vector):0;
  const margin=gateFired?Number((Number(incumbent.margin)+rawCorrection).toFixed(3)):Number(incumbent.margin);
  const total=Number(incumbent.total);
  const home=gateFired?Number(((total+margin)/2).toFixed(3)):Number(incumbent.home);
  const away=gateFired?Number(((total-margin)/2).toFixed(3)):Number(incumbent.away);
  const sigma=finite(incumbent.sigmaMargin)??13.8;
  const pHomeWin=normalCdf(margin/sigma);
  return {
    ok:true,
    modelId:NFL_QB_PERSONNEL_SHADOW_ID,
    lifecycle:"SHADOW",
    championGovernanceId:fit.championGovernanceId,
    incumbentModelId:incumbent.modelId||null,
    incumbentModelVersion:incumbent.version||null,
    gate:{...NFL_QB_PERSONNEL_GATE,fired:gateFired,combinedQbBurden:burden.combinedQbBurden,homeQbBurden:burden.homeQbBurden,awayQbBurden:burden.awayQbBurden},
    personnel:{home:burden.home,away:burden.away},
    marginCorrection:gateFired?Number(rawCorrection.toFixed(4)):0,
    margin,total,home,away,pHomeWin,
    sigmaMargin:sigma,
    incumbent:{home:incumbent.home,away:incumbent.away,margin:incumbent.margin,total:incumbent.total,pHomeWin:incumbent.pHomeWin,sigmaMargin:incumbent.sigmaMargin},
    invariants:{
      totalUnchanged:total===Number(incumbent.total),
      challengerEqualsIncumbentWhenGateClosed:gateFired?null:(margin===Number(incumbent.margin)&&total===Number(incumbent.total)&&home===Number(incumbent.home)&&away===Number(incumbent.away)),
      genericInjuryAdjustmentApplied:false,
      productionChampionModified:false,
      wagerAuthorityModified:false,
    },
    fit:{modelId:fit.modelId,trainedRows:fit.trainedRows,trainingThroughSeason:fit.trainingThroughSeason},
    canQualify:false,
    canAuthorizeWager:false,
  };
}

function americanImplied(price){
  const p=finite(price);if(p==null||p===0)return null;
  return p<0?(-p)/((-p)+100):100/(p+100);
}
function noVigPair(homePrice,awayPrice){
  const h=americanImplied(homePrice),a=americanImplied(awayPrice);
  if(h==null||a==null||h+a<=0)return {home:null,away:null,overround:null};
  return {home:h/(h+a),away:a/(h+a),overround:h+a-1};
}
export function executableNflMarketSnapshot(game={}){
  const m=game.market||{},x=m.execution||{},offer=x.selectedOffer||x.bestOffer||m.comparison||{};
  const num=(...vs)=>{for(const v of vs){const n=finite(v);if(n!=null)return n}return null};
  const moneylineHome=num(
    x.moneylineHome,x.homeMoneyline,x.moneyline?.home,offer.moneylineHome,offer.homeMoneyline,offer.moneyline?.home,
    m.moneyline?.home,game.odds?.moneyline?.home,game.odds?.homeMoneyline,game.odds?.heritageMoneylineHome,game.odds?.softMoneylineHome
  );
  const moneylineAway=num(
    x.moneylineAway,x.awayMoneyline,x.moneyline?.away,offer.moneylineAway,offer.awayMoneyline,offer.moneyline?.away,
    m.moneyline?.away,game.odds?.moneyline?.away,game.odds?.awayMoneyline,game.odds?.heritageMoneylineAway,game.odds?.softMoneylineAway
  );
  const noVig=noVigPair(moneylineHome,moneylineAway);
  return {
    sportsbook:x.book||offer.book||game.odds?.softSource||null,
    actionable:Boolean(m.executionActionable??x.actionable??x.available??false),
    spreadHome:num(x.spread,offer.spread,game.odds?.spread),
    spreadHomePrice:num(x.spreadHomePrice,x.homeSpreadPrice,x.spreadPrice?.home,offer.spreadHomePrice,game.odds?.heritageSpreadHomePrice,game.odds?.softSpreadHomePrice),
    spreadAwayPrice:num(x.spreadAwayPrice,x.awaySpreadPrice,x.spreadPrice?.away,offer.spreadAwayPrice,game.odds?.heritageSpreadAwayPrice,game.odds?.softSpreadAwayPrice),
    total:num(x.total,offer.total,game.odds?.total),
    overPrice:num(x.overPrice,x.totalOverPrice,x.totalPrice?.over,offer.overPrice,game.odds?.heritageOverPrice,game.odds?.softOverPrice),
    underPrice:num(x.underPrice,x.totalUnderPrice,x.totalPrice?.under,offer.underPrice,game.odds?.heritageUnderPrice,game.odds?.softUnderPrice),
    moneylineHome,moneylineAway,
    noVigHomeProbability:noVig.home,
    noVigAwayProbability:noVig.away,
    moneylineOverround:noVig.overround,
    observedAt:x.observedAt||offer.observedAt||game.market?.observedAt||game.odds?.observedAt||null,
    stale:Boolean(game.marketStale||game.odds?.stale||x.freshness==="STALE"),
  };
}
