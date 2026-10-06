import { sha256Hex } from "./sha256Hex.js";
import {
  SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
  SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  SOCCER_ROUTE_VERSION,
  resolveSoccerResearchRoute,
} from "./soccerResearchRouting.js";
import { evaluateCachedMarketFreshness } from "./marketLineage.js";

const CORE_ASIAN_LINES = new Set([-0.5,0,0.5]);
const SNAPSHOT_BUCKET_MS = 5 * 60 * 1000;

function finite(v){
  if(v==null||v==="")return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function bucketIso(value=new Date().toISOString()){
  const t=Date.parse(value);
  if(!Number.isFinite(t))return null;
  return new Date(Math.floor(t/SNAPSHOT_BUCKET_MS)*SNAPSHOT_BUCKET_MS).toISOString();
}
function before(a,b){
  const x=Date.parse(a),y=Date.parse(b);
  return Number.isFinite(x)&&Number.isFinite(y)&&x<y;
}
function marketObservationAt(slate={}){
  return slate?.parlay?.observedAt||slate?.parlay?.asOf||null;
}
function twoWaySnapshot(pair,line,observedAt,snapshotAt,kickoff){
  const freshness=evaluateCachedMarketFreshness({observedAt},{nowMs:Date.parse(snapshotAt),maxAgeMs:20*60*1000});
  if(!pair?.complete)return{available:false,reason:"MARKET_INCOMPLETE",line:null,observedAt:null};
  if(!observedAt)return{available:false,reason:"MARKET_TIMESTAMP_UNAVAILABLE",line:null,observedAt:null};
  if(!freshness.ok)return{available:false,reason:freshness.code||"MARKET_STALE",line:null,observedAt};
  if(!before(observedAt,kickoff)||Date.parse(observedAt)>Date.parse(snapshotAt)){
    return{available:false,reason:"MARKET_NOT_PREKICK",line:null,observedAt};
  }
  return{
    available:true,reason:null,line:finite(line),observedAt,
    a:{price:finite(pair.priceA),noVig:finite(pair.noVigA)},
    b:{price:finite(pair.priceB),noVig:finite(pair.noVigB)},
  };
}
function totalProb(model,side){
  const node=model?.totals?.["2.5"]||model?.totals?.[2.5]||null;
  return finite(node?.[side]);
}
function asianProb(model,line,side){
  const node=model?.homeAsian?.[String(line)]||null;
  const win=finite(node?.win),loss=finite(node?.loss);
  if(win==null||loss==null||win+loss<=0)return null;
  return side==="HOME"?win/(win+loss):loss/(win+loss);
}
function rowBase({game,route,marketFamily,selection,snapshotAt,idempotencyBucket,collectorCodeSha}){
  const eventId=String(game?.id||game?.pitchMatchId||"");
  const routeId=route.routeId;
  return{
    shadowId:`ss_${sha256Hex([SOCCER_ROUTE_VERSION,eventId,marketFamily,selection,idempotencyBucket].join("|"))}`,
    eventId,
    competitionKey:route.competition,
    marketFamily,
    selection,
    eventStartAt:game.start||game.date||null,
    snapshotAt,
    routeId,
    routeVersion:route.routeVersion,
    evidenceSnapshotId:route.evidenceSnapshot,
    evidenceCodeSha:route.evidenceCodeSha,
    incumbentModelId:route.incumbentModel,
    challengerModelId:route.challengerModel,
    selectedResearchModelId:route.challengerModel,
    collectorCodeSha:collectorCodeSha||null,
  };
}
function noMarket(reason){
  return{
    marketNoVigProbability:null,entryLine:null,entryPrice:null,lineTimestamp:null,
    marketHistoryAvailable:0,marketUnavailableReason:reason,
  };
}
function probabilityRow(args,{v2Probability,v31Probability,market=null,projectionValue=null}={}){
  return{
    ...rowBase(args),
    v2Probability:finite(v2Probability),
    v31Probability:finite(v31Probability),
    v2ProjectionValue:finite(projectionValue?.v2),
    v31ProjectionValue:finite(projectionValue?.v31),
    ...(market||noMarket("MARKET_UNAVAILABLE")),
  };
}
function routeFor(competition,marketFamily){
  const resolved=resolveSoccerResearchRoute({
    competition,marketFamily,
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  return resolved.ok?resolved.route:null;
}

export function buildSoccerProspectiveShadowRecords(game={},slate={},{
  snapshotAt=new Date().toISOString(),
  collectorCodeSha=null,
}={}){
  const kickoff=game.start||game.date||null;
  const snapshotMs=Date.parse(snapshotAt);
  if(!Number.isFinite(snapshotMs))return{ok:false,reason:"post-kickoff-or-invalid-time",rows:[]};
  const snapshot=new Date(snapshotMs).toISOString();
  const idempotencyBucket=bucketIso(snapshot);
  if(!idempotencyBucket||!kickoff||!before(snapshot,kickoff)){
    return{ok:false,reason:"post-kickoff-or-invalid-time",rows:[]};
  }
  const competition=String(game.soccerLeague||game.league||"");
  const v2=game.soccerFbisV2||game.soccerFbis||game.researchProjection||null;
  const v31=game.soccerFbisV3||game?.challengers?.["SOCCER-FBIS-v3.1"]||null;
  if(!competition){
    return{ok:false,reason:"competition-unavailable",detail:"missing-league-mapping",rows:[]};
  }
  if(!v2?.ok){
    return{ok:false,reason:"v2-projection-unavailable",detail:String(v2?.reason||"v2-projection-unavailable"),rows:[]};
  }
  if(!v31?.ok){
    return{ok:false,reason:"v31-projection-unavailable",detail:String(v31?.reason||"v31-projection-unavailable"),rows:[]};
  }
  if(v2?.provenance?.marketUsed===true||v31?.provenance?.marketUsed===true||v31?.provenance?.persistentStateUsed===true){
    return{ok:false,reason:"model-governance-violation",rows:[]};
  }

  const rows=[];
  const observedAt=marketObservationAt(slate);
  const pin=game.pin||{};

  const one=routeFor(competition,"1X2");
  if(one){
    for(const [selection,k] of [["HOME","pHomeWin"],["DRAW","pDraw"],["AWAY","pAwayWin"]]){
      rows.push(probabilityRow({game,route:one,marketFamily:"1X2",selection,snapshotAt:snapshot,idempotencyBucket,collectorCodeSha},{
        v2Probability:v2[k],v31Probability:v31[k],
        market:noMarket("COMPLETE_3WAY_1X2_MARKET_UNAVAILABLE"),
      }));
    }
  }

  const goals=routeFor(competition,"GOALS");
  if(goals){
    for(const [selection,k] of [["HOME_GOALS","home"],["AWAY_GOALS","away"],["TOTAL_GOALS","total"]]){
      rows.push(probabilityRow({game,route:goals,marketFamily:"GOALS",selection,snapshotAt:snapshot,idempotencyBucket,collectorCodeSha},{
        v2Probability:null,v31Probability:null,
        projectionValue:{v2:v2[k],v31:v31[k]},
        market:noMarket("GOAL_COUNT_MARKET_NOT_CAPTURED"),
      }));
    }
  }

  const btts=routeFor(competition,"BTTS");
  if(btts){
    for(const [selection,k] of [["YES","pBttsYes"],["NO","pBttsNo"]]){
      rows.push(probabilityRow({game,route:btts,marketFamily:"BTTS",selection,snapshotAt:snapshot,idempotencyBucket,collectorCodeSha},{
        v2Probability:v2[k],v31Probability:v31[k],
        market:noMarket("BTTS_MARKET_UNAVAILABLE"),
      }));
    }
  }

  const totals=routeFor(competition,"TOTALS_O25");
  if(totals){
    const line=finite(game?.odds?.pinTotal??game?.odds?.total);
    const snap=line===2.5
      ? twoWaySnapshot(pin.total,2.5,observedAt,snapshot,kickoff)
      : {available:false,reason:"O25_MARKET_NOT_AVAILABLE"};
    for(const [selection,side,mktSide] of [["OVER","over","a"],["UNDER","under","b"]]){
      const market=snap.available?{
        marketNoVigProbability:finite(snap[mktSide]?.noVig),
        entryLine:2.5,
        entryPrice:finite(snap[mktSide]?.price),
        lineTimestamp:snap.observedAt,
        marketHistoryAvailable:1,
        marketUnavailableReason:null,
      }:noMarket(snap.reason);
      rows.push(probabilityRow({game,route:totals,marketFamily:"TOTALS_O25",selection,snapshotAt:snapshot,idempotencyBucket,collectorCodeSha},{
        v2Probability:totalProb(v2,side),v31Probability:totalProb(v31,side),market,
      }));
    }
  }

  const asian=routeFor(competition,"ASIAN_HANDICAP");
  if(asian){
    const line=finite(game?.odds?.pinSpread??game?.odds?.spread);
    const core=line!=null&&CORE_ASIAN_LINES.has(line);
    const snap=core
      ? twoWaySnapshot(pin.spread,line,observedAt,snapshot,kickoff)
      : {available:false,reason:"CORE_ASIAN_LINE_NOT_AVAILABLE"};
    if(core){
      for(const [selection,mktSide] of [["HOME","a"],["AWAY","b"]]){
        const sideLine=selection==="HOME"?line:-line;
        const market=snap.available?{
          marketNoVigProbability:finite(snap[mktSide]?.noVig),
          entryLine:sideLine,
          entryPrice:finite(snap[mktSide]?.price),
          lineTimestamp:snap.observedAt,
          marketHistoryAvailable:1,
          marketUnavailableReason:null,
        }:noMarket(snap.reason);
        rows.push(probabilityRow({game,route:asian,marketFamily:"ASIAN_HANDICAP",selection,snapshotAt:snapshot,idempotencyBucket,collectorCodeSha},{
          v2Probability:asianProb(v2,line,selection),v31Probability:asianProb(v31,line,selection),market,
        }));
      }
    }
  }

  const provenance={
    routeVersion:SOCCER_ROUTE_VERSION,
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
    collectorCodeSha:collectorCodeSha||null,
    modelFreezeAt:snapshot,
    marketObservedAt:observedAt,
    modelMarketSeparation:true,
    v2MarketUsed:false,
    v31MarketUsed:false,
    persistentStateUsed:false,
    executionEvidence:false,
    authoritativeModel:"SOCCER-FBIS-v2",
    publicProjectionRoutingChanged:false,
  };
  return{ok:true,competition,snapshotAt:snapshot,rows:rows.map(r=>({...r,provenance})),provenance};
}

export async function persistSoccerProspectiveShadow(db,records=[]){
  if(!db?.prepare)return{ok:false,written:0,existing:0,reason:"d1-unavailable"};
  let written=0,existing=0;
  for(const r of records){
    const result=await db.prepare(`INSERT OR IGNORE INTO soccer_prospective_shadow(
      shadow_id,event_id,competition_key,market_family,selection,event_start_at,snapshot_at,
      route_id,route_version,evidence_snapshot_id,evidence_code_sha,incumbent_model_id,challenger_model_id,selected_research_model_id,
      v2_probability,v31_probability,v2_projection_value,v31_projection_value,
      market_no_vig_probability,entry_line,entry_price,line_timestamp,
      market_history_available,market_unavailable_reason,provenance_json,
      research_only,can_qualify,can_authorize
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      r.shadowId,r.eventId,r.competitionKey,r.marketFamily,r.selection,r.eventStartAt,r.snapshotAt,
      r.routeId,r.routeVersion,r.evidenceSnapshotId,r.evidenceCodeSha,r.incumbentModelId,r.challengerModelId,r.selectedResearchModelId,
      r.v2Probability,r.v31Probability,r.v2ProjectionValue,r.v31ProjectionValue,
      r.marketNoVigProbability,r.entryLine,r.entryPrice,r.lineTimestamp,
      r.marketHistoryAvailable,r.marketUnavailableReason,JSON.stringify(r.provenance||{}),
      1,0,0
    ).run();
    const changed=Number(result?.meta?.changes||0);
    written+=changed;existing+=changed?0:1;
  }
  return{ok:true,written,existing,total:records.length};
}

function binaryMetrics(p,y){
  const q=finite(p);
  if(q==null||![0,1].includes(Number(y)))return{brier:null,logLoss:null};
  const clipped=Math.max(1e-9,Math.min(1-1e-9,q));
  return{brier:(q-y)**2,logLoss:-(y*Math.log(clipped)+(1-y)*Math.log(1-clipped))};
}
export function gradeSoccerShadowProbability({v2Probability,v31Probability,outcome}={}){
  const y=Number(outcome);
  return{
    v2:binaryMetrics(v2Probability,y),
    v31:binaryMetrics(v31Probability,y),
  };
}
export function gradeSoccerShadowValue({v2ProjectionValue,v31ProjectionValue,actual}={}){
  const a=finite(actual),v2=finite(v2ProjectionValue),v31=finite(v31ProjectionValue);
  return{
    v2AbsError:a==null||v2==null?null:Math.abs(v2-a),
    v31AbsError:a==null||v31==null?null:Math.abs(v31-a),
  };
}
export function simulatedUnitResult({result,americanPrice}={}){
  const p=finite(americanPrice);
  if(!["WIN","LOSS","PUSH"].includes(result)||p==null||p===0)return null;
  if(result==="PUSH")return 0;
  if(result==="LOSS")return-1;
  return p>0?p/100:100/Math.abs(p);
}
