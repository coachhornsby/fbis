import test from "node:test";
import assert from "node:assert/strict";
import {toDurableBoardGame,loadDurableTodayGames} from "../functions/lib/todayDurableFallback.js";
import {classifyBoardStatus} from "../functions/lib/gameStatus.js";
import {buildTodayBoard} from "../functions/lib/todayBoard.js";

const today="2026-10-10",now=Date.parse("2026-10-10T22:00:00Z");
const cfb=(id="cfb-1",patch={})=>({
  id,sport:"cfb",date:today,start:"2026-10-10T23:00:00Z",
  home_name:"Texas",away_name:"Oklahoma",home_abbr:"TEX",away_abbr:"OU",
  updated_at:"2026-10-10T20:00:00Z",frozen_at:"2026-10-10T20:00:00Z",
  proj_home:28,proj_away:24,engine:"CFB-FBIS-v2",model_version:"cfb-test-v2",
  ...patch,
});
function db(rows){const metrics={calls:0,sql:null,bindings:[]};return {
  metrics,
  prepare(sql){
    metrics.calls++;metrics.sql=sql;
    return {bind(...args){metrics.bindings=args;return {all:async()=>({results:rows})}}};
  },
};}
test("read-only fallback marks a recovered game as unverified, never a live result or wager",()=>{
  const original=cfb();
  const before=JSON.stringify(original);
  const game=toDurableBoardGame(original,{date:today,now});
  assert.equal(game.id,"cfb-1");
  assert.equal(game.model.projHome,28);
  assert.equal(game.model.projAway,24);
  assert.equal(game.model.pHomeFinal,null);
  assert.equal(game.status.live,false);
  assert.equal(game.status.completed,false);
  assert.equal(classifyBoardStatus(game,now),"unverified");
  assert.equal(game.qualificationBlocked,true);
  assert.equal(game.canQualify,false);
  assert.equal(game.canAuthorizeWager,false);
  assert.equal(game.bettingAuthority,"NOT_ELIGIBLE");
  assert.deepEqual(game.playerMarkets,[]);
  assert.deepEqual(game.playerProjectionRows,[]);
  assert.deepEqual(game.odds,{});
  assert.equal(game.durableFallback.boardDate,today);
  assert.equal(JSON.stringify(original),before);
});
test("poststart, future and missing scoring snapshots cannot masquerade as pregame score",()=>{
  for(const patch of [{frozen_at:"2026-10-11T00:00:00Z"},{frozen_at:"2026-10-10T22:15:00Z"},{frozen_at:null},{proj_home:null}]){
    const x=toDurableBoardGame(cfb("x",patch),{date:today,now});
    assert.ok(x);
    assert.equal(x.projectionKind,"UNAVAILABLE",JSON.stringify(patch));
    assert.equal(x.model.projHome,null);
    assert.equal(x.model.projAway,null);
    assert.equal(x.qualificationBlocked,true);
  }
  assert.equal(toDurableBoardGame(cfb("x",{start:"2026-10-11T23:00:00Z"}),{date:today,now}),null);
  assert.equal(toDurableBoardGame(cfb("x",{home_abbr:null}),{date:today,now}),null);
});
test("D1 date-scoped fallback never writes or accesses provider endpoints",async()=>{
  const store=db([cfb("a"),cfb("b",{sport:"nhl",home_abbr:"BUF",away_abbr:"UTA"})]);
  const all=await loadDurableTodayGames({DB:store},today,"all",{now});
  assert.equal(all.ok,true);
  assert.equal(all.games.length,2);
  assert.equal(all.games[1].sport,"nhl");
  assert.match(store.metrics.sql,/FROM games g/);
  assert.match(store.metrics.sql,/LEFT JOIN prediction_snapshots/);
  assert.match(store.metrics.sql,/p\.frozen_at<g\.start/);
  assert.match(store.metrics.sql,/rn=1/);
  assert.match(store.metrics.sql,/SELECT \*/);
  assert.doesNotMatch(store.metrics.sql,/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i);
  assert.equal(store.metrics.calls,1);
  assert.deepEqual(store.metrics.bindings.slice(1),[today,"all","all"]);
});
test("focused upstream exception restores schedule cards from D1 rather than empty board",async()=>{
  const store=db([cfb()]);
  const data=await buildTodayBoard(today,{DB:store},{
    focusSport:"cfb",now,
    buildSlateFn:async()=>{throw Error("ESPN_503");},
  });
  assert.equal(data.counts.games,1);
  assert.equal(data.counts.durableFallbackGames,1);
  assert.equal(data.games[0].status,"unverified");
  assert.equal(data.games[0].rec,null);
  assert.equal(data.games[0].canQualify,false);
  assert.equal(data.feeds.cfb.source,"D1_SCHEDULE_PRESTART_SNAPSHOT");
  assert.equal(data.feeds.cfb.error,null);
  assert.match(data.feeds.cfb.warning,/ESPN_503/);
});
test("injected healthy focused builder keeps its real projection and status",async()=>{
  const store=db([cfb()]);
  const data=await buildTodayBoard(today,{DB:store},{
    focusSport:"cfb",now,
    querySnapshotsFn:async()=>({ok:true,rows:[]}),
    queryOddsSnapshotsFn:async()=>({ok:true,rows:[]}),
    buildSlateFn:async()=>({
      sport:"cfb",date:today,
      games:[{
        id:"cfb-1",sport:"cfb",start:"2026-10-10T23:00:00Z",
        home:{name:"Texas",abbr:"TEX"},away:{name:"Oklahoma",abbr:"OU"},
        status:{detail:"Scheduled"},
        model:{projHome:32,projAway:24,projTotal:56,projMargin:8,projectionKind:"FBIS"},
        projectionKind:"FBIS",odds:{},
      }],
      parlay:{cached:true,skipped:true},
    }),
  });
  assert.equal(data.counts.games,1);
  assert.equal(data.counts.durableFallbackGames,0);
  assert.equal(data.games[0].projHome,32);
  assert.equal(data.games[0].durableFallback,null);
});
