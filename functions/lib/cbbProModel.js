/**
 * CBB-PRO-v1
 * Production CBB projection/decision contract.
 *
 * SIDE: KenPom projection vs market, fixed >=4.0 point disagreement gate,
 * independently confirmed by CBBD on the same side, |market spread| <20.
 * Winning historical subsets are retained as tags; they do not change the gate.
 *
 * TOTAL: separate research engine. 50/50 KenPom + CBBD projected total,
 * with a research screen at market total 145-155 and |edge| >=4.
 * Totals have no wager authority until separately validated.
 */
export const CBB_PRO_ID="CBB-PRO-v1";
export const CBB_PRO_VERSION="v1.0.0";
export const CBB_PRO_DATASET={version:"cbb-enriched-v2026.10.02",sha256:"10d2e1af07ac31d6b6174b9cda37eb63aa8785a9050cfede0c8c1ccce52933f9",rows:43076};
export const SIDE_EDGE_MIN=4;
export const SIDE_MARKET_SPREAD_MAX=20;
export const TOTAL_EDGE_MIN=4;
export const TOTAL_MARKET_MIN=145;
export const TOTAL_MARKET_MAX=155;
function n(v){if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null}
function r1(v){return Math.round(Number(v)*10)/10}
function projSpread(p){const m=n(p?.margin);return m==null?null:-m}
function marketSpread(game){return n(game?.odds?.pinSpread??game?.odds?.spread)}
function marketTotal(game){return n(game?.odds?.pinTotal??game?.odds?.total)}
function sideName(game,home){return home?(game?.home?.abbr||game?.home?.school||game?.home?.name||"HOME"):(game?.away?.abbr||game?.away?.school||game?.away?.name||"AWAY")}
export function buildCbbPro(game){
 const kp=game?.challengers?.["CBB-KENPOM-RATINGS-v1"],cb=game?.challengers?.["CBB-CBBD-RATINGS-v1"];
 const ms=marketSpread(game),mt=marketTotal(game),ks=projSpread(kp),cs=projSpread(cb);
 const kpOk=Boolean(kp?.ok&&ks!=null),cbOk=Boolean(cb?.ok&&cs!=null);
 const kEdge=kpOk&&ms!=null?r1(ms-ks):null,cEdge=cbOk&&ms!=null?r1(ms-cs):null;
 const direction=kEdge==null||kEdge===0?null:(kEdge>0?"HOME":"AWAY");
 const cbDirection=cEdge==null||cEdge===0?null:(cEdge>0?"HOME":"AWAY");
 const sameSide=Boolean(direction&&direction===cbDirection);
 const spreadOk=ms!=null&&Math.abs(ms)<SIDE_MARKET_SPREAD_MAX;
 const edgeOk=kEdge!=null&&Math.abs(kEdge)>=SIDE_EDGE_MIN;
 const qualified=Boolean(kpOk&&cbOk&&ms!=null&&edgeOk&&sameSide&&spreadOk);
 const selectedHome=direction==="HOME";
 const tags=[];
 if(cEdge!=null&&Math.abs(cEdge)>=2)tags.push("CBBD_CONFIRM_GE2");
 if(cEdge!=null&&Math.abs(cEdge)>=3)tags.push("CBBD_CONFIRM_GE3");
 if(kEdge!=null&&Math.abs(kEdge)>=6)tags.push("KENPOM_EDGE_GE6");
 if(kEdge!=null&&cEdge!=null&&Math.abs(kEdge-cEdge)<=2)tags.push("MODELS_WITHIN_2");
 if(kEdge!=null&&cEdge!=null&&Math.abs(kEdge-cEdge)<=1)tags.push("MODELS_WITHIN_1");
 if(game?.neutralSite||game?.neutral)tags.push("NEUTRAL_SITE");
 if(direction&&ms!=null&&((selectedHome&&ms>0)||(!selectedHome&&ms<0)))tags.push("UNDERDOG");
 const side={status:qualified?"QUALIFIED":"PASS",qualified,pick:qualified?sideName(game,selectedHome):null,direction,marketSpread:ms,kenpomSpread:ks,cbbdSpread:cs,kenpomEdge:kEdge,cbbdEdge:cEdge,sameSideConfirmation:sameSide,tags,gate:{kenpomEdgeMin:SIDE_EDGE_MIN,requiresCbbdSameSide:true,maxAbsMarketSpread:SIDE_MARKET_SPREAD_MAX},authority:{productionCandidate:true,canQualify:true,canAuthorizeWager:false,reason:"Historical selected-row prices unavailable; research accounting used assumed -110."}};
 const kt=n(kp?.total),ct=n(cb?.total),pt=kt!=null&&ct!=null?r1((kt+ct)/2):null,te=pt!=null&&mt!=null?r1(pt-mt):null;
 const totalCandidate=Boolean(pt!=null&&mt!=null&&mt>=TOTAL_MARKET_MIN&&mt<=TOTAL_MARKET_MAX&&Math.abs(te)>=TOTAL_EDGE_MIN);
 const total={status:totalCandidate?"RESEARCH_CANDIDATE":"PASS",qualified:false,researchCandidate:totalCandidate,pick:totalCandidate?(te>0?"OVER":"UNDER"):null,marketTotal:mt,projectedTotal:pt,kenpomTotal:kt,cbbdTotal:ct,edge:te,gate:{marketRange:[TOTAL_MARKET_MIN,TOTAL_MARKET_MAX],edgeMin:TOTAL_EDGE_MIN},authority:{productionProjection:true,canQualify:false,canAuthorizeWager:false,reason:"Total engine requires separate validation; side rules never authorize totals."}};
 const home=n(kp?.home),away=n(kp?.away);
 return {ok:kpOk&&cbOk,modelId:CBB_PRO_ID,modelVersion:CBB_PRO_VERSION,projectionKind:"FBIS",home,away,total:home!=null&&away!=null?r1(home+away):null,margin:home!=null&&away!=null?r1(home-away):null,side,totalDecision:total,dataset:CBB_PRO_DATASET,provenance:{sideProjection:"KenPom adjusted ratings",sideConfirmation:"CBBD prior-only independent projection",totalProjection:"50/50 KenPom + CBBD totals",marketUse:"post-projection qualification only"},governance:{sideGateFrozen:true,sub4Rejected:true,subsetTagsDoNotAlterGate:true,sideAndTotalIndependent:true}};
}
export function attachCbbPro(games=[]){let projected=0,qualified=0,totalCandidates=0;const out=games.map(g=>{if(g?.sport&&g.sport!=="cbb")return g;const p=buildCbbPro(g);if(p.ok)projected++;if(p.side.qualified)qualified++;if(p.totalDecision.researchCandidate)totalCandidates++;if(!p.ok)return{...g,cbbPro:p};return{...g,cbbPro:p,projHomeScore:p.home,projAwayScore:p.away,model:{...(g.model||{}),projHome:p.home,projAway:p.away,projTotal:p.total,projMargin:p.margin,projectionKind:"FBIS",modelId:CBB_PRO_ID,modelVersion:CBB_PRO_VERSION},projectionKind:"FBIS",projectionDisplayLabel:"CBB-PRO-v1",projectionEngine:CBB_PRO_ID,publicationStatus:"PRODUCTION_PROJECTION",bettingAuthority:p.side.qualified?"SIDE_CANDIDATE_NO_AUTO_WAGER":"NO_AUTO_WAGER",canQualify:p.side.qualified,qualificationBlocked:true};});return{games:out,meta:{modelId:CBB_PRO_ID,version:CBB_PRO_VERSION,projected,sideQualified:qualified,totalResearchCandidates:totalCandidates,sideCanQualify:true,canAuthorizeWager:false,totalCanQualify:false,dataset:CBB_PRO_DATASET}}}
