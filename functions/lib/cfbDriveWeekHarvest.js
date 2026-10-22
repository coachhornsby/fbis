/**
 * Authorized CFB week-only drive research harvest.
 * Avoids the season-wide /games request that is intentionally single-owner /
 * one reservation per day. Uses two new week-scoped provider requests via the
 * SAME quota ledger, not direct fetch() or a new collector.
 */
import {cfbdGet} from "./collegeApi.js";
import {cfbDailyFinals} from "./cfbDailyPostgame.js";
import {ingestCfbDriveBatch} from "./cfbDriveSimulationStore.js";

export async function harvestCfbVerifiedDriveWeek(env={},{
  year,week,operatorApproved=false,trigger="http",fetchFn,
}={}){
  if(trigger!=="workflow_dispatch"||operatorApproved!==true||
      env.cfbdNetworkAuthorized!==true||env.cfbdCacheOnly===true)
    return {ok:false,status:"denied",reason:"OPERATOR_APPROVAL_REQUIRED",networkCalls:0};
  if(!env.CFB_DB?.prepare)
    return {ok:false,status:"blocked",reason:"CFB_DB_UNBOUND",networkCalls:0};
  if(env.CFB_DRIVE_RESEARCH_COLLECTION!=="enabled")
    return {ok:false,status:"blocked",reason:"CFB_DRIVE_RESEARCH_NOT_ENABLED",networkCalls:0};
  if(!Number.isInteger(year)||year<2023||year>2026||
     !Number.isInteger(week)||week<1||week>16)
    return {ok:false,status:"blocked",reason:"INVALID_CFB_SEASON_WEEK",networkCalls:0};
  // This operational request explicitly permits only the agreed Oct 6-10 2026
  // Week 6. Any expansion must go through another explicit approval/release.
  if(year!==2026||week!==6)
    return {ok:false,status:"blocked",reason:"WEEK_NOT_APPROVED_FOR_ONE_TIME_HARVEST",networkCalls:0};

  const fetchOpts=fetchFn?{fetchFn}:{};
  const gameQuery={year,week,seasonType:"regular"};
  const drivesQuery={year,week,seasonType:"regular",classification:"fbs"};
  const games=await cfbdGet("/games",env,{query:gameQuery,...fetchOpts});
  if(!games.ok||!Array.isArray(games.data))
    return {ok:false,status:"failed",reason:games.reason||"CFBD_WEEKLY_GAMES_UNAVAILABLE",
      gamesHttp:games.status,networkCalls:games.networkAttempted===false?0:1,
      providerGames:0,accepted:0};

  const dates=["2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10"];
  const unique=new Map();
  for(const date of dates){
    for(const game of cfbDailyFinals(games.data,date)){
      const gameId=String(game.id??game.gameId??"");
      if(Number(game.week)!==week ||
         String(game.seasonType||game.season_type||"regular")!=="regular")continue;
      unique.set(gameId,game);
    }
  }
  const finals=[...unique.values()];
  // No drive provider request without FBS/FBS official finals.
  if(!finals.length)return {ok:false,status:"blocked",reason:"NO_VERIFIED_CFB_WEEK6_FINALS",
    gamesHttp:games.status,providerGames:games.data.length,accepted:0,networkCalls:1};
  if(finals.length>120)return {ok:false,status:"blocked",reason:"CFB_WEEK6_GAME_CAP_EXCEEDED",
    verifiedFinals:finals.length,accepted:0,networkCalls:1};
  const drives=await cfbdGet("/drives",env,{query:drivesQuery,...fetchOpts});
  if(!drives.ok||!Array.isArray(drives.data))
    return {ok:false,status:"failed",reason:drives.reason||"CFBD_WEEKLY_DRIVES_UNAVAILABLE",
      verifiedFinals:finals.length,driveHttp:drives.status,accepted:0,networkCalls:2};
  const idSet=new Set(finals.map(g=>String(g.id??g.gameId)));
  const selected=drives.data.filter(d=>idSet.has(String(d?.gameId)));
  if(selected.length>3600)return {ok:false,status:"blocked",reason:"CFB_WEEK6_DRIVE_CAP_EXCEEDED",
    matchedDrives:selected.length,accepted:0,networkCalls:2};
  const result=await ingestCfbDriveBatch(env,{
    finals,drives:selected,observedAt:new Date().toISOString(),
  });
  return {ok:true,status:"success",job:"cfb-drive-week6-harvest",season:year,week,
    scope:"2026-10-06..2026-10-10",providerGames:games.data.length,
    verifiedFinals:finals.length,providerDrives:drives.data.length,
    matchedDrives:selected.length,accepted:result.inserted,
    alreadyPresent:result.existing,rejected:result.rejected,
    examples:result.examples,
    networkCalls:2,source:"CFBD_DRIVES",sourceDatabase:"CFB_DB",
    canAuthorizeWager:false,changesProductionChampion:false};
}
