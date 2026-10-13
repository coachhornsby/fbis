/**
 * Polymarket US read-only research adapter.
 * US gateway is a different exchange from Polymarket International Gamma/CLOB.
 * No private API, credentials, order placement, inferred EV, or wagering authority.
 * https://docs.polymarket.us/api-reference/introduction
 */
export const POLY_US_API = "https://gateway.polymarket.us";
export const FBIS_POLY_SPORTS = Object.freeze([
  "nfl","cfb","cbb","nba","wnba","mlb","npb","kbo","nhl","soccer","tennis"
]);
const CLEAN = value => String(value??"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ");
const CODE_ALIASES = {tbr:"tb",tampa:"tb",sfg:"sf",sd:"sdp",wsn:"wsh",was:"wsh",kcr:"kc",az:"ari",chw:"cws"};
const tidyCode = value => CODE_ALIASES[CLEAN(value).replace(/ /g,"")]||CLEAN(value).replace(/ /g,"");
export function classifyPolymarketUsLeague(league={}) {
  const slug=CLEAN(league.slug).replace(/ /g,"-"), name=CLEAN(league.name);
  const is=(re)=>re.test(slug)||re.test(name);
  if(is(/^(nfl|national-football-league)$|national football league/))return "nfl";
  if(is(/^(ncaaf|cfb|college-football)$|college football|ncaa football/))return "cfb";
  if(is(/^(ncaab|ncaam|ncaaw|cbb|college-basketball)$|college basketball|ncaa basketball/))return "cbb";
  if(is(/^wnba$|womens national basketball|women s national basketball/))return "wnba";
  if(is(/^nba$|national basketball association/))return "nba";
  if(is(/^mlb$|major league baseball/))return "mlb";
  if(is(/^npb$|nippon professional baseball/))return "npb";
  if(is(/^kbo$|korea baseball organization|korean baseball/))return "kbo";
  if(is(/^nhl$|national hockey league/))return "nhl";
  if(is(/^(atp|wta|tennis|challenger|itf)(-|$)|^(atp|wta|tennis)$| tennis | tennis$|atp tour|wta tour/))return "tennis";
  if(is(/soccer|association football|premier league|champions league|liga mx|la liga|laliga|bundesliga|serie a|league one|ligue 1|^mls$|major league soccer|copa|europa league|^epl$|^ucl$|^uefa$|^world-cup$|^eredivisie$/))return "soccer";
  return null;
}
export function chicagoMarketDay(value){
  const stamp=Date.parse(value||"");
  if(!Number.isFinite(stamp))return null;
  const f=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"});
  const p=f.formatToParts(new Date(stamp)),part=t=>p.find(x=>x.type===t)?.value;
  return [part("year"),part("month"),part("day")].join("-");
}
export function marketEventStart(e={}){
  return e.startTime||e.eventDate||e.startDate||e.gameStartTime||null;
}
function normName(x){return CLEAN(x).replace(/\b(the|club|fc|football|basketball|baseball|hockey|team)\b/g,"").replace(/\s+/g," ").trim();}
const GENERIC_TEAM_TOKENS=new Set(["city","united","town","club","athletic","sporting","real","international","national","state","university","college","rovers"]);
function teamMatches(a,b,abbr){
  const x=normName(a), y=normName(b);
  if(!x||!y)return false;
  if(x===y)return true;
  if(abbr && tidyCode(abbr)===tidyCode(a))return true;
  // Exchange team sides may display just nicknames ("Magic"/"Cavaliers")
  // and soccer feeds may use local variants ("Lens"/"Racing Club de Lens").
  // Require a distinct non-generic suffix, plus two-team/2h/unique-game gate.
  const short=x.length<y.length?x:y,long=x.length<y.length?y:x;
  if(short.length>=4 && !GENERIC_TEAM_TOKENS.has(short) && long.endsWith(" "+short))return true;
  return false;
}
/** Match only with two independent team identities and <=2h kickoff tolerance.
 * Do not derive canonical ID from Polymarket IDs or bookmaker prices. */
export function matchPolymarketUsEvent(e,games=[],sport){
  const start=Date.parse(marketEventStart(e)||"");
  if(!Number.isFinite(start))return {id:null,reason:"EVENT_START_UNVERIFIED"};
  const sides=Array.isArray(e.markets)?e.markets.flatMap(m=>m.marketSides||[]):[];
  const participants=[e.awayTeam?.name,e.homeTeam?.name,
    ...(e.teams||[]).map(x=>x.name||x),
    ...sides.flatMap(x=>[x.team?.name,x.description])].filter(Boolean);
  const title=String(e.title||"");
  const candidates=games.filter(g=>{
    const gt=Date.parse(g.start||"");
    if(!Number.isFinite(gt)||Math.abs(gt-start)>2*60*60*1000)return false;
    const away=g.away_name||g.awayName||g.away?.name,home=g.home_name||g.homeName||g.home?.name;
    if(!away||!home)return false;
    const names=(participants.length?participants:[]).concat(title);
    return [away,home].every((name,i)=>
      names.some(n=>teamMatches(n,name,i===0?g.away_abbr:g.home_abbr))||
      normName(name).length>=4 && !GENERIC_TEAM_TOKENS.has(normName(name)) &&
      normName(title).includes(normName(name))
    );
  });
  return candidates.length===1?{id:String(candidates[0].id),reason:"TWO_TEAM_KICKOFF_VERIFIED"}:
    {id:null,reason:candidates.length?"AMBIGUOUS_EVENT_MATCH":"UNMATCHED_PROVIDER_EVENT"};
}
export function parsePolymarketUsPrice(value){
  // An absent quote or order-book side is NOT a zero-price contract.
  const raw=typeof value==="object"&&value!==null?value.value:value;
  if(raw==null||typeof raw==="string"&&!raw.trim())return null;
  const n=Number(raw);
  return Number.isFinite(n)&&n>=0&&n<=1?Number(n.toFixed(5)):null;
}
export function polymarketUsMarketFamily(m={}){
  const type=String(m.sportsMarketTypeV2||m.sportsMarketType||m.marketType||"").toUpperCase();
  if(type.includes("MONEYLINE")||type==="ML")return "moneyline";
  if(type.includes("SPREAD")||type.includes("HANDICAP"))return "spread";
  if(type.includes("TOTAL")||type.includes("OVER_UNDER"))return "total";
  if(type.includes("PLAYER")||type.includes("PROP"))return "player_prop";
  return "unclassified";
}
/** Display quote != executable best ask. Preserve both distinctly. */
export function polymarketUsMarketOffers(e,sport,{canonicalId=null,capturedAt=new Date().toISOString(),maxMarkets=8}={}){
  const markets=Array.isArray(e.markets)?e.markets.slice(0,Math.max(0,maxMarkets)):[];
  const offers=[];
  const providerEventId=String(e.id||e.gameId||"");
  const start=marketEventStart(e);
  for(const m of markets){
    const slug=String(m.slug||m.id||"");
    if(!slug)continue;
    const family=polymarketUsMarketFamily(m);
    const sides=Array.isArray(m.marketSides)?m.marketSides:[];
    for(const side of sides){
      const price=parsePolymarketUsPrice(side.quote ?? side.price);
      // Quote is an app display/reference probability; may NOT be the best ask.
      const label=String(side.description||side.team?.name||side.identifier||side.id||"");
      if(!label)continue;
      offers.push({
        source:"Polymarket US",sourceType:"exchange",sport,league:String(e.seriesSlug||sport),
        eventId:canonicalId,eventStart:start,
        homeTeam:e.homeTeam?.name||null,awayTeam:e.awayTeam?.name||null,
        marketFamily:family,statFamily:null,side:label,line:m.line,
        contractPrice:price,americanOdds:null,executionEligible:false,
        standardOrAlt:"unknown",period:"full_game",sourceMarketId:slug,
        sourceOutcomeId:String(side.id||side.identifier||label),fetchedAt:null,
        raw:{providerEventId,providerMarketId:String(m.id||slug),providerOutcomeId:String(side.id||""),
          providerTitle:e.title||null,marketTitle:m.question||m.title||null,
          providerMarketType:m.sportsMarketTypeV2||m.sportsMarketType||null,
          marketState:m.status||null,providerEventState:e.eventState?.type||null,
          isLive:Boolean(e.live||e.eventState?.live),sideDescription:label,
          displayedProbability:price,priceKind:"DISPLAY_QUOTE_NOT_BEST_ASK",
          bestBid:parsePolymarketUsPrice(m.bestBidQuote),bestAsk:parsePolymarketUsPrice(m.bestAskQuote),
          quoteProvenance:"collector-capture-only",collectorCapturedAt:capturedAt,
          sourceObservedAt:null,marketObservedAt:null,
          canQualify:false,canAuthorizeWager:false,modelInfluence:"none"}
      });
    }
  }
  return offers;
}
async function getJson(fetchImpl,path,{limit=50,offset=0}={}){
  const url=new URL(path,POLY_US_API);
  if(limit!=null)url.searchParams.set("limit",String(limit));
  if(offset!=null)url.searchParams.set("offset",String(offset));
  const resp=await fetchImpl(url.toString(),{headers:{"accept":"application/json"}});
  if(!resp.ok)throw Error("polymarket-us HTTP "+resp.status+" "+url.pathname);
  return resp.json();
}
export async function fetchPolymarketUsLeagues(fetchImpl=fetch,{maxPages=6}={}){
  const leagues=[],seen=new Set();
  for(let p=0;p<maxPages;p++){
    const body=await getJson(fetchImpl,"/v2/leagues",{limit:50,offset:p*50});
    if(!Array.isArray(body?.leagues))throw Error("polymarket-us leagues API contract changed");
    for(const l of body.leagues){if(!l.slug||seen.has(l.slug))continue;seen.add(l.slug);leagues.push(l)}
    if(body.leagues.length<50)return {leagues,complete:true};
  }
  return {leagues,complete:false};
}
export async function fetchPolymarketUsLeagueEvents(slug,fetchImpl=fetch,{limit=60}={}){
  if(!/^[a-z0-9-]{1,100}$/i.test(slug))throw Error("Invalid public league slug");
  const data=await getJson(fetchImpl,"/v2/leagues/"+encodeURIComponent(slug)+"/events",{limit,offset:0});
  if(!Array.isArray(data?.events))throw Error("polymarket-us league events API contract changed: "+slug);
  return data.events;
}
