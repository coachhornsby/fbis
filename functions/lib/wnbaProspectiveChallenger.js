import { pGreater } from "./metrics.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
const mean=xs=>{const a=xs.filter(x=>Number.isFinite(x));return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};

export const WNBA_GAMESTATE_CHALLENGER_ID="WNBA-FBIS-GAMESTATE-v1";
export const WNBA_LINEUP_CHALLENGER_ID="WNBA-FBIS-LINEUP-v1";
export const WNBA_PACE_CHALLENGER_ID="WNBA-FBIS-PACE-v1";
export const WNBA_COMBINED_CHALLENGER_ID="WNBA-FBIS-POSSESSION-CHALLENGER-v1";
export const WNBA_PLAYER_OPPORTUNITY_ID="WNBA-PLAYER-OPPORTUNITY-v1";
export const WNBA_POSSESSION_CHALLENGER_VERSION="prospective-shadow-v1";
export const WNBA_COMBINED_MIN_ISOLATED_N=30;
export const WNBA_LINEUP_RELIABILITY_REPORT_THRESHOLD=0.55;

function espnTeamId(team={}){
  if(team.espnId!=null)return String(team.espnId);
  const m=String(team.canonicalId||team.id||"").match(/^[a-z]+-(\d+)$/i);
  return m?m[1]:String(team.id||"").replace(/^wnba-/,"")||null;
}
function parseJson(v){if(v&&typeof v==="object")return v;try{return JSON.parse(v||"{}")}catch{return{}}}

export async function loadWnbaPossessionChallengerContext(db){
  if(!db?.prepare)return {teams:{},coefficients:{},sampleCounts:{},meta:{available:false,reason:"db_unavailable"}};
  try{
    const [teamRes,coefRes,countRes]=await Promise.all([
      db.prepare(`
        WITH ranked AS (
          SELECT *,ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY as_of DESC) rn
          FROM wnba_team_possession_feature_snapshots
        )
        SELECT * FROM ranked WHERE rn=1
      `).all(),
      db.prepare("SELECT * FROM wnba_possession_challenger_coefficients WHERE production_eligible=0").all(),
      db.prepare(`
        SELECT model_id,COUNT(DISTINCT event_id) n
        FROM wnba_game_possession_challenger_shadow
        GROUP BY model_id
      `).all()
    ]);
    const teams={},coefficients={},sampleCounts={};
    for(const r of teamRes?.results||[]){
      teams[String(r.team_id)]={
        teamId:String(r.team_id),asOf:r.as_of,games:Number(r.games||0),
        closePossessions:finite(r.close_possessions),closeOrtg:finite(r.close_ortg),closeOrtgShrunk:finite(r.close_ortg_shrunk),
        reconstructedPace:finite(r.reconstructed_pace),paceStability:finite(r.pace_stability),
        lineupNet100:finite(r.lineup_net100),lineupPossessions:finite(r.lineup_possessions),
        lineupDurationCoverage:finite(r.lineup_duration_coverage),substitutionResolution:finite(r.substitution_resolution),
        lineupReliability:finite(r.lineup_reliability),feature:parseJson(r.feature_json)
      };
    }
    for(const r of coefRes?.results||[]){
      const id=String(r.model_id),target=String(r.target||"").toUpperCase();
      if(!coefficients[id])coefficients[id]={modelId:id,version:r.model_version,sourceCheckpoint:r.source_checkpoint,targets:{}};
      coefficients[id].targets[target]={intercept:finite(r.intercept)||0,slope:finite(r.slope)||0,n:Number(r.train_n||0),details:parseJson(r.details_json)};
    }
    for(const r of countRes?.results||[])sampleCounts[String(r.model_id)]=Number(r.n||0);
    return {teams,coefficients,sampleCounts,meta:{available:true,teams:Object.keys(teams).length,coefficients:Object.keys(coefficients).length,sampleCounts}};
  }catch(err){
    return {teams:{},coefficients:{},sampleCounts:{},meta:{available:false,error:String(err?.message||err)}};
  }
}

function correction(ctx,modelId,target,signal){
  const c=ctx?.coefficients?.[modelId]?.targets?.[String(target).toUpperCase()];
  const x=finite(signal);if(!c||x==null)return null;
  return {value:c.intercept+c.slope*x,intercept:c.intercept,slope:c.slope,n:c.n};
}
function baseProjection(game){
  const b=game?.wnbaV2||game?.researchProjection;
  if(!b||finite(b.home)==null||finite(b.away)==null)return null;
  return {
    home:finite(b.home),away:finite(b.away),margin:finite(b.margin)??finite(b.home)-finite(b.away),
    total:finite(b.total)??finite(b.home)+finite(b.away),
    sigmaMargin:finite(b.sigmaMargin)??10.2,sigmaTotal:finite(b.sigmaTotal)??12.1
  };
}
function applyCorrections(base,{marginCorrection=0,totalCorrection=0}={}){
  const m=finite(marginCorrection)||0,t=finite(totalCorrection)||0;
  const margin=base.margin+m,total=base.total+t;
  const home=(total+margin)/2,away=(total-margin)/2;
  return {home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
    sigmaMargin:base.sigmaMargin,sigmaTotal:base.sigmaTotal,pHomeWin:pGreater(margin,0,base.sigmaMargin)};
}
function shadow(modelId,base,projection,{homeFeature=null,awayFeature=null,featureDelta=null,reliability=null,lineupReliability=null,feature={},ctx={}}={}){
  return {
    ok:true,modelId,modelVersion:WNBA_POSSESSION_CHALLENGER_VERSION,
    ...projection,
    baseline:{...base},
    featureCutoffTimestamp:feature.cutoff||null,
    feature:{home:homeFeature,away:awayFeature,delta:featureDelta,reliability,lineupReliability,...feature},
    coefficientSource:ctx?.coefficients?.[modelId]?.sourceCheckpoint||null,
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,maturity:"PROSPECTIVE_SHADOW"
  };
}

export function attachWnbaProspectiveGameChallengers(games=[],ctx={}){
  const leaguePace=mean(Object.values(ctx.teams||{}).map(x=>finite(x.reconstructedPace)));
  const isolatedIds=[WNBA_GAMESTATE_CHALLENGER_ID,WNBA_LINEUP_CHALLENGER_ID,WNBA_PACE_CHALLENGER_ID];
  const combinedEnabled=isolatedIds.every(id=>Number(ctx.sampleCounts?.[id]||0)>=WNBA_COMBINED_MIN_ISOLATED_N);
  let attached=0;
  const next=(games||[]).map(game=>{
    const base=baseProjection(game),homeId=espnTeamId(game.home),awayId=espnTeamId(game.away);
    if(!base||!homeId||!awayId)return {...game,wnbaPossessionChallengers:{}};
    const h=ctx.teams?.[homeId],a=ctx.teams?.[awayId];
    if(!h||!a)return {...game,wnbaPossessionChallengers:{}};
    const cutoff=[h.asOf,a.asOf].filter(Boolean).sort().at(0)||null;
    const out={};

    const gsSignal=finite(h.closeOrtgShrunk)!=null&&finite(a.closeOrtgShrunk)!=null?h.closeOrtgShrunk-a.closeOrtgShrunk:null;
    const gsM=correction(ctx,WNBA_GAMESTATE_CHALLENGER_ID,"MARGIN",gsSignal);
    if(gsM){
      out[WNBA_GAMESTATE_CHALLENGER_ID]=shadow(WNBA_GAMESTATE_CHALLENGER_ID,base,applyCorrections(base,{marginCorrection:gsM.value}),{
        homeFeature:h.closeOrtgShrunk,awayFeature:a.closeOrtgShrunk,featureDelta:gsSignal,
        reliability:Math.min(1,Math.min(h.closePossessions||0,a.closePossessions||0)/180),
        feature:{cutoff,homeClosePossessions:h.closePossessions,awayClosePossessions:a.closePossessions,coefficient:gsM},ctx
      });
    }

    const lineSignal=finite(h.lineupNet100)!=null&&finite(a.lineupNet100)!=null?h.lineupNet100-a.lineupNet100:null;
    const lineRel=Math.min(finite(h.lineupReliability)||0,finite(a.lineupReliability)||0);
    const lM=correction(ctx,WNBA_LINEUP_CHALLENGER_ID,"MARGIN",lineSignal),lT=correction(ctx,WNBA_LINEUP_CHALLENGER_ID,"TOTAL",lineSignal);
    if(lM||lT){
      out[WNBA_LINEUP_CHALLENGER_ID]=shadow(WNBA_LINEUP_CHALLENGER_ID,base,applyCorrections(base,{
        marginCorrection:(lM?.value||0)*lineRel,totalCorrection:(lT?.value||0)*lineRel
      }),{
        homeFeature:h.lineupNet100,awayFeature:a.lineupNet100,featureDelta:lineSignal,reliability:lineRel,lineupReliability:lineRel,
        feature:{cutoff,homeLineupPossessions:h.lineupPossessions,awayLineupPossessions:a.lineupPossessions,
          homeDurationCoverage:h.lineupDurationCoverage,awayDurationCoverage:a.lineupDurationCoverage,
          homeSubstitutionResolution:h.substitutionResolution,awaySubstitutionResolution:a.substitutionResolution,
          reliabilityApplied:true,marginCoefficient:lM,totalCoefficient:lT},ctx
      });
    }

    const paceHome=finite(h.reconstructedPace),paceAway=finite(a.reconstructedPace);
    const paceSignal=paceHome!=null&&paceAway!=null&&leaguePace!=null?(paceHome+paceAway)/2-leaguePace:null;
    const pM=correction(ctx,WNBA_PACE_CHALLENGER_ID,"MARGIN",paceSignal),pT=correction(ctx,WNBA_PACE_CHALLENGER_ID,"TOTAL",paceSignal);
    if(pM||pT){
      const paceRel=Math.min(finite(h.paceStability)||0,finite(a.paceStability)||0);
      out[WNBA_PACE_CHALLENGER_ID]=shadow(WNBA_PACE_CHALLENGER_ID,base,applyCorrections(base,{
        marginCorrection:(pM?.value||0)*paceRel,totalCorrection:(pT?.value||0)*paceRel
      }),{
        homeFeature:paceHome,awayFeature:paceAway,featureDelta:paceSignal,reliability:paceRel,
        feature:{cutoff,leaguePace,homePaceStability:h.paceStability,awayPaceStability:a.paceStability,marginCoefficient:pM,totalCoefficient:pT},ctx
      });
    }

    if(combinedEnabled&&out[WNBA_GAMESTATE_CHALLENGER_ID]&&out[WNBA_LINEUP_CHALLENGER_ID]&&out[WNBA_PACE_CHALLENGER_ID]){
      const gs=out[WNBA_GAMESTATE_CHALLENGER_ID],li=out[WNBA_LINEUP_CHALLENGER_ID],pa=out[WNBA_PACE_CHALLENGER_ID];
      const mCorr=(gs.margin-base.margin)+(li.margin-base.margin)+(pa.margin-base.margin);
      const tCorr=(gs.total-base.total)+(li.total-base.total)+(pa.total-base.total);
      out[WNBA_COMBINED_CHALLENGER_ID]=shadow(WNBA_COMBINED_CHALLENGER_ID,base,applyCorrections(base,{marginCorrection:mCorr,totalCorrection:tCorr}),{
        reliability:Math.min(gs.feature.reliability??1,li.feature.reliability??1,pa.feature.reliability??1),
        lineupReliability:li.feature.lineupReliability,
        feature:{cutoff,activationRule:`isolated_n>=${WNBA_COMBINED_MIN_ISOLATED_N}`,isolatedSampleCounts:ctx.sampleCounts},ctx
      });
    }
    attached+=Object.keys(out).length;
    return {...game,wnbaPossessionChallengers:out};
  });
  return {games:next,meta:{attached,combinedEnabled,combinedMinIsolatedN:WNBA_COMBINED_MIN_ISOLATED_N,leaguePace,models:isolatedIds,combinedModel:WNBA_COMBINED_CHALLENGER_ID,canQualify:false,canAuthorize:false,marketInformed:false}};
}

function oppMarketProjection(row,impactCtx,roleCtx,expectedTeammates=null){
  const base=finite(row?.fbisProjection),market=String(row?.market||"");
  if(base==null)return null;
  const skill=impactCtx?.skill||{};
  const role=roleCtx?.role||{};
  const availabilityVerified=Boolean(roleCtx?.availabilityVerified);
  const baseMinutes=finite(row?.role?.minutes)??finite(skill.minutes)??24;
  const minutesMean=clamp(baseMinutes+(availabilityVerified?(finite(role.minutesDelta)||0):0),0,40);
  const games=Math.max(1,Number(skill.games||row?.role?.games||1));
  const minutesSd=clamp(7/Math.sqrt(Math.min(games,16))+2.2,2.5,6.5);
  const usageMean=finite(skill.usage);
  const usageSd=usageMean==null?null:clamp(Math.abs(usageMean)*0.10,1.0,4.5);
  const fgaMean=usageMean==null?null:usageMean*minutesMean/40*0.72;
  const tpaRate=finite(skill.threesPer40),tpaMean=tpaRate==null?null:Math.max(0,tpaRate*2.55*minutesMean/40);
  const rebOppMean=market==="rebounds"&&finite(skill.reboundsPer40)!=null?finite(skill.reboundsPer40)*minutesMean/40:null;
  const astOppMean=market==="assists"&&finite(skill.assistsPer40)!=null?finite(skill.assistsPer40)*minutesMean/40:null;
  // Mean remains anchored to the incumbent until opportunity model earns a prospective correction.
  // Distributional state is the research object being validated.
  return {
    projection:base,sigma:finite(row?.fbisSigma),
    minutesMean,minutesSd,usageMean,usageSd,
    fgaMean,fgaSd:fgaMean==null?null:Math.max(1,Math.sqrt(fgaMean)*0.85),
    tpaMean,tpaSd:tpaMean==null?null:Math.max(.7,Math.sqrt(tpaMean)*.75),
    reboundOppMean:rebOppMean,reboundOppSd:rebOppMean==null?null:Math.max(1,Math.sqrt(rebOppMean)*.8),
    assistOppMean:astOppMean,assistOppSd:astOppMean==null?null:Math.max(.8,Math.sqrt(astOppMean)*.8),
    availabilityVerified,
    expectedTeammates,
    availabilityContext:roleCtx?.unavailable||[],
    featureCutoffTimestamp:roleCtx?.featureCutoffTimestamp||null,
    modelId:WNBA_PLAYER_OPPORTUNITY_ID,modelVersion:WNBA_POSSESSION_CHALLENGER_VERSION,
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    note:"Opportunity distribution shadow. Mean remains anchored to incumbent until prospective evidence supports a mean correction."
  };
}
export function attachWnbaPlayerOpportunityShadows(games=[],impactCtx={}){
  let rows=0;
  const next=(games||[]).map(game=>{
    const projected=game.playerProjectionRows||[];
    return {
      ...game,
      playerProjectionRows:projected.map(row=>{
        const p=impactCtx.players?.[String(row.playerId)]||null,rc=impactCtx.roles?.[String(row.playerId)]||null;
        const unavailableIds=new Set((rc?.unavailable||[]).filter(x=>String(x.status||"").toUpperCase()==="OUT").map(x=>String(x.playerId)));
        const expectedTeammates=[...new Map(projected
          .filter(x=>String(x.team||"")===String(row.team||"")&&String(x.playerId)!==String(row.playerId)&&!unavailableIds.has(String(x.playerId)))
          .map(x=>[String(x.playerId),{playerId:String(x.playerId),playerName:x.playerName}])).values()];
        const shadow=oppMarketProjection(row,p,rc,expectedTeammates);
        if(shadow)rows++;
        return {...row,opportunityShadow:shadow};
      })
    };
  });
  return {games:next,meta:{modelId:WNBA_PLAYER_OPPORTUNITY_ID,rows,canQualify:false,canAuthorize:false,marketInformed:false}};
}
