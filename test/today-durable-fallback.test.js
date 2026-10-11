import test from "node:test";
import assert from "node:assert/strict";
import {toDurableBoardGame,loadDurableTodayGames,hasDurableScheduleAuthority} from "../functions/lib/todayDurableFallback.js";
import {classifyBoardStatus} from "../functions/lib/gameStatus.js";
import {buildTodayBoard} from "../functions/lib/todayBoard.js";

const today="2026-10-10",now=Date.parse("2026-10-10T22:00:00Z");
const cfb=(id="401856714",patch={})=>({
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
  assert.equal(game.id,"401856714");
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
    const x=toDurableBoardGame(cfb("401000001",patch),{date:today,now});
    assert.ok(x);
    assert.equal(x.projectionKind,"UNAVAILABLE",JSON.stringify(patch));
    assert.equal(x.model.projHome,null);
    assert.equal(x.model.projAway,null);
    assert.equal(x.qualificationBlocked,true);
  }
  assert.equal(toDurableBoardGame(cfb("401000001",{start:"2026-10-11T23:00:00Z"}),{date:today,now}),null);
  assert.equal(toDurableBoardGame(cfb("401000001",{home_abbr:null}),{date:today,now}).home.abbr,null);
});
test("D1 date-scoped fallback never writes or accesses provider endpoints",async()=>{
  const store=db([cfb("401000001"),cfb("401000002",{sport:"nhl",home_abbr:"BUF",away_abbr:"UTA"})]);
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
test("focused upstream exception withholds CFB schedule cards without verified participant IDs",async()=>{
  const store=db([cfb()]);
  const data=await buildTodayBoard(today,{DB:store},{
    focusSport:"cfb",now,
    buildSlateFn:async()=>{throw Error("ESPN_503");},
  });
  assert.equal(data.counts.games,0);
  assert.equal(data.counts.durableFallbackGames,0);
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
        id:"401856714",sport:"cfb",start:"2026-10-10T23:00:00Z",
        home:{name:"Texas",abbr:"TEX",espnId:"251"},away:{name:"Oklahoma",abbr:"OU",espnId:"201"},
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

test("ALL sports uses one read-only D1 query and does not invoke live builders",async()=>{
  const store=db([
    cfb("401000001"),
    cfb("401000002",{sport:"nhl",home_abbr:"BUF",away_abbr:"UTA"}),
    cfb("401000003",{sport:"nba",home_abbr:"LAL",away_abbr:"BOS"}),
  ]);
  const board=await buildTodayBoard(today,{DB:store},{now});
  assert.equal(board.counts.games,2);
  assert.equal(board.counts.durableFallbackGames,2);
  assert.equal(board.parlay.durableReadOnly,true);
  assert.equal(board.feeds.cfb.n,0);
  assert.equal(board.feeds.nhl.n,1);
  assert.equal(board.feeds.nba.n,1);
  assert.equal(board.games.length,2);
  assert.ok(board.games.every(g=>g.status==="unverified" && !g.canQualify && g.rec==null));
  assert.equal(store.metrics.calls,1);
});

test("only provenance-backed ESPN event IDs appear on durable CFB/NBA/MLB schedules",async()=>{
  for (const id of [
    "ncaaf_newhampshirewildcats_northcarolinaataggie_2026-10-10_b2",
    "012b453d730520dc6cb5a14f96fb0dd9",
    "1ccc08315a60e310",
  ]) {
    for (const sport of ["cfb","nba","mlb"]) {
      const candidate=cfb(id,{sport});
      assert.equal(hasDurableScheduleAuthority(candidate),false);
      assert.equal(toDurableBoardGame(candidate,{date:today,now}),null);
    }
  }
  assert.equal(hasDurableScheduleAuthority(cfb("401856714")),true);
  const store=db([
    cfb("401856714"),
    cfb("012b453d730520dc6cb5a14f96fb0dd9",{
      away_name:"Dartmouth Big Green",away_abbr:"—",home_name:"Yale Bulldogs",home_abbr:"—"
    }),
    cfb("ncaaf_newhampshirewildcats_northcarolinaataggie_2026-10-10_b2",{
      away_name:"New Hampshire",away_abbr:"—",home_name:"North Carolina",home_abbr:"UNC"
    }),
    cfb("401898397",{sport:"nba",away_name:"Minnesota",away_abbr:"MIN",home_name:"Miami",home_abbr:"MIA"}),
  ]);
  const result=await loadDurableTodayGames({DB:store},today,"all",{now});
  assert.equal(result.ok,true);
  assert.deepEqual(result.games.map(g=>g.id),["401856714","401898397"]);
  assert.match(store.metrics.sql,/g\.id NOT GLOB/);
  assert.equal(store.metrics.calls,1);
});

test("missing verified team abbreviation is null, never a fabricated school abbreviation",()=>{
  const game=toDurableBoardGame(cfb("401856714",{
    home_name:"Yale Bulldogs",home_abbr:"—",away_name:"Dartmouth Big Green",away_abbr:"—"
  }),{date:today,now});
  assert.equal(game.away.abbr,null);
  assert.equal(game.home.abbr,null);
  assert.equal(game.away.name,"Dartmouth Big Green");
  assert.equal(game.home.name,"Yale Bulldogs");
});
