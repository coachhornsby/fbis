/**
 * Auditable FREE ESPN NHL scoreboard market observations.
 * These are not Pinnacle lines, executable offers, opening/closing prices,
 * or model inputs. Never reconstruct observations after puck drop.
 */
function american(v) {
  if(v==null||v==="")return null;
  const n=Number(v);
  return Number.isInteger(n) && Math.abs(n)>=100 && Math.abs(n)<=10000 ? n : null;
}
function implied(price) {
  return price>0?100/(price+100):Math.abs(price)/(Math.abs(price)+100);
}
export function packNhlEspnMarketObservations(game,{date,at=new Date().toISOString(),checkpoint=null}={}) {
  const odds=game?.odds||{};
  const startMs=Date.parse(game?.start||""),atMs=Date.parse(at||"");
  if(String(game?.sport||"").toLowerCase()!=="nhl"||odds.softSource!=="espn"||
      !Number.isFinite(startMs)||!Number.isFinite(atMs)||atMs>=startMs||!game.id){
    return {rows:[],reason:"NOT_PREGAME_ESPN_NHL_QUOTE"};
  }
  // Never re-label an independently ingested sportsbook quote as ESPN.
  if(odds.pinPresent===true||odds.heritageListed===true)return {rows:[],reason:"OTHER_BOOK_SOURCE_PRESENT"};
  const h=american(odds.homeMl),a=american(odds.awayMl);
  if(h==null||a==null)return {rows:[],reason:"NO_ESPN_TWO_SIDED_MONEYLINE"};
  const sum=implied(h)+implied(a);
  if(sum<0.94||sum>1.25)return {rows:[],reason:"UNPLAUSIBLE_ESPN_MONEYLINE_PAIR"};
  const base={gameId:String(game.id),sport:"nhl",date:date||null,
    book:"ESPN_FEED_REFERENCE",market:"ml",period:"fg",line:null,
    capturedAt:at,gameStart:game.start,checkpoint,rejectedPostStart:0,paired:1,
    eventId:String(game.id)};
  return {rows:[
    {...base,side:"HOME",price:h,implied:implied(h),noVig:implied(h)/sum},
    {...base,side:"AWAY",price:a,implied:implied(a),noVig:implied(a)/sum}
  ],reason:null};
}

const FREE_SOFT_SOURCES=new Set(["sharpapi","therundown"]);
function softBookName(odds={}) {
  const name=String(odds.moneylineBook||odds.quoteBook||odds.homeMlBook||odds.book||"").trim();
  if(!name)return null;
  const upper=name.toUpperCase();
  if(upper==="PINNACLE"||upper==="ESPN_FEED_REFERENCE"||upper==="ESPN")return null;
  return name;
}

/**
 * Durable FREE soft-book NHL observations (SharpAPI / TheRundown).
 * Real bookmaker names only — never Pinnacle, never ESPN_FEED_REFERENCE.
 * Research/display only; never grants wager authority.
 */
export function packNhlSoftBookMarketObservations(game,{date,at=new Date().toISOString(),checkpoint=null}={}) {
  const odds=game?.odds||{};
  const startMs=Date.parse(game?.start||"");
  const freezeMs=Date.parse(at||"");
  const soft=String(odds.softSource||"").toLowerCase();
  // Freeze-time gate: never write soft market rows after puck drop.
  if(String(game?.sport||"").toLowerCase()!=="nhl"||!FREE_SOFT_SOURCES.has(soft)||
      !Number.isFinite(startMs)||!Number.isFinite(freezeMs)||freezeMs>=startMs||!game.id){
    return {rows:[],reason:"NOT_PREGAME_SOFT_NHL_QUOTE"};
  }
  if(odds.pinPresent===true||odds.heritageListed===true)return {rows:[],reason:"OTHER_BOOK_SOURCE_PRESENT"};
  const book=softBookName(odds);
  if(!book)return {rows:[],reason:"NO_REAL_SOFT_BOOK_NAME"};
  const h=american(odds.homeMl),a=american(odds.awayMl);
  if(h==null||a==null)return {rows:[],reason:"NO_SOFT_TWO_SIDED_MONEYLINE"};
  const sum=implied(h)+implied(a);
  if(sum<0.94||sum>1.25)return {rows:[],reason:"UNPLAUSIBLE_SOFT_MONEYLINE_PAIR"};
  // capturedAt is always FBIS freeze/acquisition time — never substitute provider clocks.
  // sourceObservedAt is kept on the packed row when verified; odds_snapshots cannot store it
  // (no migration). Consumers must treat snapshot-hydrate freshness as unverified unless an
  // existing evidence path (e.g. nhl_bookmaker_quote_evidence) recovers the provider clock.
  const observedMs=Date.parse(odds.observedAt||odds.sourceTimestamp||"");
  const sourceObservedAt=Number.isFinite(observedMs)&&observedMs<startMs&&observedMs<=freezeMs
    ? new Date(observedMs).toISOString()
    : null;
  const base={gameId:String(game.id),sport:"nhl",date:date||null,
    book,market:"ml",period:"fg",line:null,
    capturedAt:at,sourceObservedAt,gameStart:game.start,checkpoint,rejectedPostStart:0,paired:1,
    eventId:String(game.id)};
  // Moneyline pair only — do not invent puck/total prices when soft quotes omit them.
  return {rows:[
    {...base,side:"HOME",price:h,implied:implied(h),noVig:implied(h)/sum},
    {...base,side:"AWAY",price:a,implied:implied(a),noVig:implied(a)/sum}
  ],reason:null};
}

export function nhlSourceCompleteness(games=[]) {
  const nhl=games.filter(g=>String(g?.sport||"").toLowerCase()==="nhl");
  const counts={scheduled:nhl.length,pure:0,mlPairs:0,puckLines:0,totals:0,goalieExpectedOrConfirmed:0};
  const missing=[];
  for(const g of nhl){
    const o=g.odds||{}, pure=g.nhlProV2?.ok===true;
    const ml=american(o.pinHomeMl??o.homeMl)!=null&&american(o.pinAwayMl??o.awayMl)!=null;
    const puck=o.spread!=null||o.pinSpread!=null, total=o.total!=null||o.pinTotal!=null;
    const goalie=g.nhlStarterEvidence||{};
    const expected=["home","away"].every(s=>["PROJECTED","CONFIRMED"].includes(goalie?.[s]?.state));
    if(pure)counts.pure++;
    if(ml)counts.mlPairs++;
    if(puck)counts.puckLines++;
    if(total)counts.totals++;
    if(expected)counts.goalieExpectedOrConfirmed++;
    missing.push({eventId:String(g.id||""),start:g.start||null,
      away:g.away?.abbr||null,home:g.home?.abbr||null,
      pure,ml,puck,total,goalies:expected,
      projectionReason:pure?null:g.nhlProV2?.reason||"MODEL_UNAVAILABLE",
      oddsReason:ml?null:"NO_VERIFIABLE_TWO_SIDED_PRICE"});
  }
  const zeroPriceRegime=counts.scheduled>0&&counts.mlPairs===0;
  return {source:"NHL_SPORT_SOURCE_COVERAGE_v1",...counts,
    zeroPriceRegime,
    signalClass:zeroPriceRegime?"NON_EMPTY_SLATE_ZERO_ML_PAIRS":null,
    missing:missing.filter(x=>!x.pure||!x.ml||!x.goalies)};
}
