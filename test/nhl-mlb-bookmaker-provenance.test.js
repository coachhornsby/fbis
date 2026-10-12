import test from "node:test";
import assert from "node:assert/strict";
import { SHARPAPI_SPORT, sharpRowsToEvents } from "../functions/lib/sharpApi.js";
import { THERUNDOWN_SPORT, theRundownEventsToParlay } from "../functions/lib/theRundown.js";
import { summarizeParlayEvent, mergeParlay, fetchParlayOdds } from "../functions/lib/parlay.js";
import { resetCacheMem } from "../functions/lib/cache.js";
import { resolveCanonicalMarket } from "../functions/lib/canonical/marketRoles.js";

test("NHL has distinct supported free-tier bookmaker routes", () => {
  assert.equal(SHARPAPI_SPORT.nhl.league,"nhl");
  assert.deepEqual(SHARPAPI_SPORT.nhl.markets,["moneyline","puck_line","total_goals"]);
  assert.equal(THERUNDOWN_SPORT.nhl.sportId,6);
});

test("SharpAPI NHL two-sided moneyline and goal totals preserve authentic book timestamp", () => {
  const when="2026-10-11T18:30:00Z";
  const core={event_id:"nhl-1001",home_team:"Carolina Hurricanes",away_team:"Philadelphia Flyers",
    event_start_time:"2026-10-12T00:00:00Z",sportsbook:"draftkings",updated_at:when};
  const rows=[
    {...core,market_type:"moneyline",selection_type:"home",odds_american:-130},
    {...core,market_type:"moneyline",selection_type:"away",odds_american:115},
    {...core,market_type:"puck_line",selection_type:"home",line:-1.5,odds_american:170,is_main_line:true},
    {...core,market_type:"puck_line",selection_type:"away",line:1.5,odds_american:-190,is_main_line:true},
    {...core,market_type:"total_goals",selection_type:"over",line:5.5,odds_american:-105,is_main_line:true},
    {...core,market_type:"total_goals",selection_type:"under",line:5.5,odds_american:-115,is_main_line:true},
  ];
  const events=sharpRowsToEvents(rows,"nhl");
  assert.equal(events.length,1);
  const p=summarizeParlayEvent(events[0],"nhl");
  assert.equal(p.homeMl,-130);
  assert.equal(p.awayMl,115);
  assert.equal(p.spread,-1.5);
  assert.equal(p.total,5.5);
  assert.equal(p.quoteBook,"DraftKings");
  assert.equal(p.observedAt,"2026-10-11T18:30:00.000Z");
  assert.equal(p.pinPresent,false);
  assert.equal(p.heritageListed,false);
  const games=mergeParlay([{
    id:"game-1",sport:"nhl",home:{name:"Carolina Hurricanes",abbr:"CAR",canonicalId:"nhl-car"},
    away:{name:"Philadelphia Flyers",abbr:"PHI",canonicalId:"nhl-phi"},
    start:core.event_start_time,odds:{},status:{state:"pre"},
  }],[p],"nhl","2026-10-11");
  assert.equal(games.length,1);
  assert.equal(games[0].odds.book,"DraftKings");
  assert.equal(games[0].odds.homeMlBook,"DraftKings");
  assert.equal(games[0].odds.observedAt,"2026-10-11T18:30:00.000Z");
  assert.equal(games[0].odds.heritageListed,false);
});

test("never combine moneyline prices from different soft books",()=>{
  const event={
    id:"split",home_team:"Carolina Hurricanes",away_team:"Philadelphia Flyers",
    commence_time:"2026-10-12T00:00:00Z",
    bookmakers:[
      {key:"draftkings",title:"DraftKings",markets:[{key:"h2h",outcomes:[{name:"Carolina Hurricanes",price:-120}]}]},
      {key:"fanduel",title:"FanDuel",markets:[{key:"h2h",outcomes:[{name:"Philadelphia Flyers",price:100}]}]},
    ],
  };
  const p=summarizeParlayEvent(event,"nhl");
  assert.equal(p.homeMl,null);
  assert.equal(p.awayMl,null);
  assert.equal(p.pinPresent,false);
});

test("missing original bookmaker timestamp remains null, never becomes receipt time",()=>{
  const event={id:"missing",home_team:"Carolina Hurricanes",away_team:"Philadelphia Flyers",
    bookmakers:[{key:"draftkings",title:"DraftKings",markets:[{key:"h2h",outcomes:[
      {name:"Carolina Hurricanes",price:-120},{name:"Philadelphia Flyers",price:110},
    ]}]}]};
  const p=summarizeParlayEvent(event,"nhl");
  assert.equal(p.observedAt,null);
  assert.equal(p.quoteBook,"DraftKings");
});

test("NHL free fallback uses configured SharpAPI without paid keys and retains provider",async()=>{
  resetCacheMem();
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));
    const u=new URL(url);
    assert.equal(u.host,"api.sharpapi.io");
    const market=u.searchParams.get("market");
    const home="Carolina Hurricanes",away="Philadelphia Flyers",base={
      event_id:"nhl-1002",home_team:home,away_team:away,
      event_start_time:"2026-10-12T00:00:00Z",sportsbook:"draftkings",
      updated_at:"2026-10-11T18:35:00Z",
    };
    const data=market==="moneyline"?[
      {...base,market_type:market,selection_type:"home",odds_american:-140},
      {...base,market_type:market,selection_type:"away",odds_american:120},
    ]:[];
    return new Response(JSON.stringify({data}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const r=await fetchParlayOdds("nhl",null,null,{
      cacheOnly:true,strictCacheOnly:false,backupApiKey:null,
      sharpApiKey:"synthetic-key",theRundownApiKey:null,date:"2026-10-11",
    });
    assert.equal(r.events.length,1);
    assert.equal(r.meta.source,"sharpapi-free-cacheonly");
    assert.equal(r.meta.provider,"sharpapi");
    assert.equal(r.events[0].observedAt,"2026-10-11T18:35:00.000Z");
    assert.equal(calls.length,3);
    const cached=await fetchParlayOdds("nhl",null,null,{
      cacheOnly:true,strictCacheOnly:true,sharpApiKey:"synthetic-key",
    });
    assert.equal(cached.events.length,1);
    assert.equal(calls.length,3);
  }finally{globalThis.fetch=previous;resetCacheMem();}
});

test("TheRundown soft NHL market conversion retains source quote",()=>{
  const ev={event_id:2,event_date:"2026-10-12T00:00:00Z",teams_normalized:[
    {is_home:true,name:"Carolina",mascot:"Hurricanes"},
    {is_away:true,name:"Philadelphia",mascot:"Flyers"},
  ],markets:[{market_id:1,participants:[
    {name:"Carolina Hurricanes",lines:[{prices:{"19":{price:-125,updated_at:"2026-10-11T18:35:00Z"}}}]},
    {name:"Philadelphia Flyers",lines:[{prices:{"19":{price:115,updated_at:"2026-10-11T18:35:00Z"}}}]},
  ]}]};
  const rows=theRundownEventsToParlay([ev],"nhl");
  assert.equal(rows.length,1);
  const p=summarizeParlayEvent(rows[0],"nhl");
  assert.equal(p.homeMl,-125);
  assert.equal(p.awayMl,115);
  assert.equal(p.quoteBook,"DraftKings");
  assert.equal(p.observedAt,"2026-10-11T18:35:00.000Z");
});

test("verified DK/FD pairs are observable consensus, never unauthorized execution",()=>{
 const market=resolveCanonicalMarket({odds:{softSource:"sharpapi",moneylineBook:"DraftKings",pinPresent:false,
   homeMl:-130,awayMl:115,observedAt:"2026-10-11T18:30:00Z"}});
 assert.equal(market.consensus.moneyline.home,-130);
 assert.equal(market.consensus.moneyline.away,115);
 assert.equal(market.consensus.bookmaker,"DraftKings");
 assert.equal(market.execution.available,false);
});
