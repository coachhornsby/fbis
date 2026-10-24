/**
 * Strict SDV RELEASE-LEVEL possession ingestion for NBA and men's CBB.
 *
 * NBA: nba_stats_possessions + independently matched nba_stats_schedules.
 * CBB: ncaa_mbb_possessions + independently matched ncaa_mbb_schedule.
 * No boxscore-averaged synthetic possessions. No fabricated tipoff times.
 * Historical release observation dates are never backdated to the game date.
 */
import {createHash} from "node:crypto";
import {validateBasketballPossessionGame} from "./basketballSdvPossessionSimulationResearch.js";

const hash=x=>createHash("sha256").update(x).digest("hex");
const validHash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/i.test(x);
const str=x=>x===null||x===undefined||x===""||x==="NA"?"":String(x);
const int=x=>x===null||x===undefined||x===""?null:Number.isInteger(Number(x))?Number(x):null;
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const fail=s=>{throw Error(s)};
const cfg=Object.freeze({
 nba:Object.freeze({source:"nba_stats_possessions",score:"nba_stats_schedules",maxPeriod:4}),
 cbb:Object.freeze({source:"ncaa_mbb_possessions",score:"ncaa_mbb_schedule",maxPeriod:2})
});
function fields(sport,row){
 if(sport==="nba")return{
  gameId:str(row.game_id),period:int(row.period),serial:int(row.possession_number),
  order:int(row.start_order_index),owner:str(row.offense_team_id),
  defense:str(row.defense_team_id),points:int(row.points),count:row.count_as_possession
 };
 return{gameId:str(row.contest_id),
  period:int(row.period),serial:int(row.poss_num),order:int(row.poss_num),
  owner:str(row.poss_team_ncaa_team_id),
  defense:"",points:int(row.pts),count:true};
}
function trueCount(x){return x===true||x===1||x==="1"||String(x).toLowerCase()==="true"}
function matchedSchedule(sport,gameId,schedule,firstRow){
 if(!schedule||typeof schedule!=="object")fail("SDV_OFFICIAL_SCHEDULE_ABSENT");
 const id=sport==="nba"?str(schedule.game_id):str(schedule.contest_id);
 if(id!==gameId)fail("SDV_SCHEDULE_ID_MISMATCH");
 const homeId=sport==="nba"?str(schedule.home_team_id):
    str(firstRow?.home_ncaa_team_id);
 const awayId=sport==="nba"?str(schedule.away_team_id):
    str(firstRow?.away_ncaa_team_id);
 if(sport==="cbb"&&(str(schedule.home).trim().toLowerCase()!==
      str(firstRow?.home).trim().toLowerCase()||
      str(schedule.away).trim().toLowerCase()!==
      str(firstRow?.away).trim().toLowerCase()))
  fail("SDV_CBB_SCHEDULE_TEAM_NAMES_MISMATCH");
 const homeScore=int(sport==="nba"?schedule.home_pts:schedule.home_score);
 const awayScore=int(sport==="nba"?schedule.away_pts:schedule.away_score);
 if(!homeId||!awayId||homeId===awayId||
   homeScore===null||awayScore===null||homeScore<0||awayScore<0)
  fail("SDV_OFFICIAL_SCHEDULE_SCORE_UNVERIFIED");
 return{homeId,awayId,homeScore,awayScore};
}
export function normalizeSdvBasketballReleaseGame({
 sport,gameId,season,rows,schedule,observedAt,sourceArtifactHash,
 tipoff=null,tipoffEvidence=null
}={}){
 if(!cfg[sport]||!str(gameId)||!Number.isInteger(season)||season<2000||
    season>2100||!Array.isArray(rows)||!rows.length||
    !validHash(sourceArtifactHash)||!iso(observedAt))
  fail("SDV_POSSESSION_RELEASE_PROVENANCE_INVALID");
 const match=matchedSchedule(sport,gameId,schedule,rows[0]);
 const selected=[],keys=new Set(),unsupported=[];
 for(const row of rows){
  const v=fields(sport,row);
  if(v.gameId!==gameId)fail("SDV_CROSS_GAME_POSSESSION_CONTAMINATION");
  if(v.period===null||v.period<1)fail("SDV_POSSESSION_PERIOD_UNVERIFIED");
  if(v.period>cfg[sport].maxPeriod)continue;
  if(sport==="nba"&&!trueCount(v.count)){
   if(v.points!==0)fail("SDV_NONCOUNT_POSSESSION_HAS_POINTS");
   continue;
  }
  if(v.serial===null||v.order===null||v.owner!==match.homeId&&v.owner!==match.awayId||
    v.points===null||v.points<0||v.points>6)
   fail("SDV_POSSESSION_ROW_UNVERIFIED");
  if(sport==="nba"&&v.defense&&
    v.defense!==(v.owner===match.homeId?match.awayId:match.homeId))
    fail("SDV_POSSESSION_DEFENSE_TEAM_MISMATCH");
  const key=[v.period,v.serial,v.owner].join("|");
  if(keys.has(key))fail("SDV_DUPLICATE_POSSESSION_ID");
  keys.add(key);
  selected.push({...v,key});
 }
 selected.sort((a,b)=>a.period-b.period||a.order-b.order||a.serial-b.serial);
 let prevPeriod=0,lastOrder=-1;
 const possessions=selected.map((p,i)=>{
  if(p.period<prevPeriod||(p.period===prevPeriod&&p.order<=lastOrder))
    fail("SDV_POSSESSION_SOURCE_ORDER_INVALID");
  if(p.period!==prevPeriod)lastOrder=-1;
  prevPeriod=p.period;lastOrder=p.order;
  return{id:p.key,sequence:i+1,period:p.period,
   offense:p.owner===match.homeId?"home":"away",points:p.points};
 });
 const points=possessions.reduce((a,p)=>{
  a[p.offense]+=p.points;return a;
 },{home:0,away:0});
 if(points.home!==match.homeScore||points.away!==match.awayScore)
  fail("SDV_REGULATION_SCORE_MISMATCH_OR_OVERTIME");
 const derivedHash=hash(JSON.stringify({
  sourceArtifactHash,sport,gameId,season,homeId:match.homeId,awayId:match.awayId,
  possessionPoints:possessions
 }));
 // A verified daily *date* is not an exact UTC tipoff timestamp.
 const proven=Boolean(iso(tipoff)&&tipoffEvidence?.gameId===gameId&&
   validHash(tipoffEvidence.sourceFingerprint)&&
   tipoffEvidence.verified===true&&
   iso(tipoffEvidence.tipoff)===iso(tipoff));
 if(!proven)return{
  ok:true,sport,gameId,season,status:"SCORE_RECONCILED_TIPOFF_UNVERIFIED",
  count:possessions.length,sourceFingerprint:derivedHash,
  sourceObservedAt:iso(observedAt),canQualify:false,
  canAuthorizeWager:false,sourceOnly:true
 };
 const game={sport,gameId,season,tipoff:iso(tipoff),
  observedAt:iso(observedAt),homeTeamId:match.homeId,
  awayTeamId:match.awayId,
  homeRegulationScore:points.home,awayRegulationScore:points.away,
  possessions,sourceFingerprint:derivedHash,regulationOnly:true,
  sourceArtifactHash,tipoffEvidenceFingerprint:tipoffEvidence.sourceFingerprint,
  canAuthorizeWager:false
 };
 return{ok:true,sport,gameId,season,status:"VERIFIED_HISTORICAL_GAME",
  sourceObservedAt:iso(observedAt),game:validateBasketballPossessionGame(game),
  canQualify:false,canAuthorizeWager:false};
}
