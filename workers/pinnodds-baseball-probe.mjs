/**
 * Pinnodds baseball-source diagnostic. No trades, no model inputs, no wager
 * authorization and no persisted market observations. Exactly two requests:
 * baseball (sport_id=6) prematch and live, WITH specials explicitly enabled.
 * Credential is read from the existing encrypted orchestrator Worker binding.
 */
const BASE="https://pinnodds.com";
const BLOCKED=/token|api.?key|authoriz|cookie|account|session|secret/i;
const ACTUAL_STARTER=/^(?:starting[_-]?pitcher(?:s|_id|_name)?|probable[_-]?starter(?:s)?|home[_-]?(?:starting[_-]?)?pitcher|away[_-]?(?:starting[_-]?)?pitcher|pitchers|starters)$/i;
const asStr=x=>String(x??"").slice(0,160);
const size=x=>Array.isArray(x)?x.length:0;
const nonNull=x=>x!==null&&x!==undefined&&x!=="";
const TOP_N=60;
export function classifyBaseballLeague(raw){
 const name=asStr(raw).toLowerCase();
 if(/(?:^|[^a-z])npb(?:[^a-z]|$)|nippon|japan.{0,12}(?:pro|baseball|npb)|central league|pacific league/.test(name))return "NPB";
 if(/(?:^|[^a-z])kbo(?:[^a-z]|$)|korea.{0,12}(?:baseball|professional)|korean baseball/.test(name))return "KBO";
 if(/(?:^|[^a-z])mlb(?:[^a-z]|$)|major league baseball|usa.{0,12}(?:major league|mlb)/.test(name))return "MLB";
 if(/(?:^|[^a-z])minor.{0,15}league|(?:^|[^a-z])milb(?:[^a-z]|$)|triple.a|double.a/.test(name))return "MiLB";
 return "OTHER_BASEBALL";
}
function safeKeys(x){
 return x&&typeof x==="object"&&!Array.isArray(x)
 ?Object.keys(x).filter(k=>!BLOCKED.test(k)).sort().slice(0,80):[];
}
function pitcherKeys(x){
 const fields=[];
 for(const [k,v]of Object.entries(x||{})){
  if(ACTUAL_STARTER.test(k)&&nonNull(v))fields.push(k);
 }
 return fields.slice(0,12);
}
function sampleOdds(event){
 const periods=event?.periods||{};
 return Object.entries(periods).slice(0,3).map(([period,v])=>({
  period,description:asStr(v?.description||""),
  marketTypes:["money_line","spreads","totals","team_total","team_totals"].filter(k=>v?.[k]!=null),
  moneyLine:v?.money_line?{home:v.money_line.home??null,away:v.money_line.away??null}:null,
  runLines:Object.values(v?.spreads||{}).slice(0,3).map(x=>({line:x?.hdp,home:x?.home,away:x?.away,maxRisk:x?.max??null})),
  totals:Object.values(v?.totals||{}).slice(0,3).map(x=>({line:x?.points,over:x?.over,under:x?.under,maxRisk:x?.max??null}))
 }));
}
function sampleSpecial(event){
 const markets=event?.special_markets||{};
 const prices=Object.entries(markets).slice(0,2).flatMap(([period,types])=>(Array.isArray(types)?types:[]).slice(0,2).flatMap(m=>
 (Array.isArray(m.prices)?m.prices:[]).slice(0,4).map(x=>({
  period,marketType:asStr(m.type||""),name:asStr(x.name||""),participantId:x.participant_id??null,
  points:x.points??null,decimalOdds:x.price??null,maxRisk:m.max_risk??null
 }))));
 return {eventId:event.event_id??null,parentId:event.parent_id??null,
  league:asStr(event.league_name||""),description:asStr(event.special||event.title||""),
  category:asStr(event.special_category||""),units:asStr(event.special_units||""),
  sampleOutcomes:prices};
}
function analyzeBoard(data,feed,response){
 const events=Array.isArray(data?.events)?data.events:null;
 if(!events)return{feed,ok:false,reason:"events-array-not-found",http:response.status,
  status:response.headers.get("x-data-status")||"unknown",bodyKeys:safeKeys(data)};
 const parent=events.filter(e=>e&&!e.special&&!e.special_category);
 const special=events.filter(e=>e&&nonNull(e.special_category||e.special));
 const groups=new Map(),offerSample=[];
 const ensure=(name)=>{const league=asStr(name||"UNKNOWN");if(!groups.has(league))groups.set(league,{
  league,scope:classifyBaseballLeague(league),events:0,specials:0,playerProps:0,
  starterFields:new Set(),categories:new Map(),propUnits:new Map(),
  statKinds:new Map(),pricedPlayerProps:0,propExamplesByStat:new Map(),
  specialExamples:[],mainMarketTypes:new Map(),examples:[]});return groups.get(league)};
 for(const e of events){
  if(!e||typeof e!=="object")continue;
  const l=ensure(e.league_name);
  if(!e.special&&!e.special_category){l.events++;
    for(const [p,v] of Object.entries(e.periods||{})){
      for(const field of ["money_line","spreads","totals","team_total","team_totals"]){
        if(v?.[field]&&Object.keys(v[field]).length)
          l.mainMarketTypes.set(field,(l.mainMarketTypes.get(field)||0)+1);
      }
    }
    for(const k of pitcherKeys(e))l.starterFields.add(k);
    if(l.examples.length<2)l.examples.push({id:e.event_id,home:asStr(e.home),away:asStr(e.away),
      starts:e.starts??null,topFields:safeKeys(e),starterFields:pitcherKeys(e),
      samplePeriods:sampleOdds(e)});
  }else{
    l.specials++;
    const category=asStr(e.special_category||"uncategorized");
    l.categories.set(category,(l.categories.get(category)||0)+1);
    if(l.specialExamples.length<3)l.specialExamples.push({
      description:asStr(e.special),category,units:asStr(e.special_units)});
    const isProp=/player|pitcher|batter/i.test(category)||/strikeout|pitcher|hits allowed|total bases|outs recorded|stolen base/i.test(asStr(e.special));
    if(isProp){
      l.playerProps++;
      const unit=asStr(e.special_units||"UNSPECIFIED");
      l.propUnits.set(unit,(l.propUnits.get(unit)||0)+1);
      const label=(asStr(e.special)+" "+unit).toLowerCase();
      let kind="OTHER_PLAYER_PROP";
      if(/strikeout|\bks\b/.test(label))kind="STRIKEOUTS";
      else if(/outs recorded|pitching outs/.test(label))kind="PITCHING_OUTS";
      else if(/hits allowed/.test(label))kind="HITS_ALLOWED";
      else if(/walks allowed/.test(label))kind="WALKS_ALLOWED";
      else if(/earned runs allowed/.test(label))kind="EARNED_RUNS_ALLOWED";
      else if(/total bases/.test(label))kind="TOTAL_BASES";
      else if(/runs batted in|\brbi\b/.test(label))kind="RBIS";
      else if(/home runs/.test(label))kind="HOME_RUNS";
      else if(/stolen bases/.test(label))kind="STOLEN_BASES";
      else if(/\bhits\b/.test(label))kind="HITS";
      else if(/\bruns\b/.test(label))kind="RUNS";
      l.statKinds.set(kind,(l.statKinds.get(kind)||0)+1);
      const sampled=sampleSpecial(e);
      if(sampled.sampleOutcomes.some(x=>Number(x.decimalOdds)>1))l.pricedPlayerProps++;
      if(!l.propExamplesByStat.has(kind))l.propExamplesByStat.set(kind,sampled);
      if(offerSample.length<30)offerSample.push(sampled)
    }
  }
 }
 const leagues=[...groups.values()].map(g=>({
  league:g.league,scope:g.scope,events:g.events,specials:g.specials,playerProps:g.playerProps,
  categories:[...g.categories.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,15),
  propUnits:[...g.propUnits.entries()].map(([unit,count])=>({unit,count})).sort((a,b)=>b.count-a.count),
  propStatKinds:[...g.statKinds.entries()].map(([kind,count])=>({kind,count})).sort((a,b)=>b.count-a.count),
  propExamplesByStat:[...g.propExamplesByStat.values()].slice(0,15),
  pricedPlayerProps:g.pricedPlayerProps,mainMarketTypes:[...g.mainMarketTypes.entries()].map(([type,count])=>({type,count})),
  specialExamples:g.specialExamples,
  starterFields:[...g.starterFields],examples:g.examples
 })).sort((a,b)=>b.events-a.events||b.playerProps-a.playerProps);
 const classCounts=Object.fromEntries(["MLB","NPB","KBO","MiLB","OTHER_BASEBALL"].map(s=>[s,{
  events:leagues.filter(l=>l.scope===s).reduce((n,l)=>n+l.events,0),
  specials:leagues.filter(l=>l.scope===s).reduce((n,l)=>n+l.specials,0),
  playerProps:leagues.filter(l=>l.scope===s).reduce((n,l)=>n+l.playerProps,0),
  leagues:leagues.filter(l=>l.scope===s).map(l=>l.league)
 }]));
 return{feed,ok:true,http:response.status,source:"PINNODDS_DIRECT",
  status:response.headers.get("x-data-status")||"unknown",
  dataAgeMs:Number(response.headers.get("x-data-age-ms"))||null,
  eventsReturned:events.length,baseEvents:parent.length,specials:special.length,
  leagueCount:leagues.length,leagueBreakdown:classCounts,
  leagues:leagues.slice(0,TOP_N),samplePlayerProps:offerSample,
  topLevelKeys:safeKeys(data),fieldsAcrossBaseEvents:[...new Set(parent.slice(0,30).flatMap(safeKeys))].sort().slice(0,100),
  starterFieldCount:leagues.reduce((n,l)=>n+l.starterFields.length,0),
  filtered:false};
}
export async function probePinnoddsBaseball({apiKey,fetchImpl=fetch}={}){
 const capturedAt=new Date().toISOString();
 if(!apiKey)return{ok:false,reason:"PINNODDS_API_KEY_NOT_CONFIGURED",
  requestsMade:0,capturedAt,canAuthorizeWager:false};
 const paths=[
  ["prematch","/kit/v1/prematch/fixtures?sport_id=6&include_specials=1"],
  ["live","/kit/v1/markets?sport_id=6&event_type=live&include_specials=1"]
 ];
 const results=[];
 for(const [feed,path]of paths){
  try{
   const response=await fetchImpl(BASE+path,{
    method:"GET",headers:{"x-portal-apikey":apiKey,"accept":"application/json"},
    signal:AbortSignal.timeout(25000)
   });
   if(!response.ok){
    results.push({feed,ok:false,http:response.status,
      retryAfter:response.headers.get("retry-after")||null,
      reason:response.status===429?"RATE_LIMITED":response.status===401||response.status===403?"AUTH_OR_PLAN_DENIED":"UPSTREAM_UNAVAILABLE"});
    if([401,403,429].includes(response.status))break;
    continue;
   }
   const body=await response.json();
   results.push(analyzeBoard(body,feed,response));
  }catch{
   results.push({feed,ok:false,reason:"REQUEST_OR_SCHEMA_FAILURE"});
  }
 }
 return{ok:results.length===2&&results.every(x=>x.ok),
  auditKind:"BOUNDED_AUTHENTICATED_BASEBALL_MARKET_INVENTORY",
  sportId:6,sport:"Baseball",capturedAt,
  sources:["pinnodds.com/kit/v1/prematch/fixtures","pinnodds.com/kit/v1/markets"],
  requestsMade:results.length,
  requestedSpecials:true,
  privateCredentialReturned:false,
  bookmakerAccountAccess:false,
  modifiesModels:false,
  canQualify:false,canAuthorizeWager:false,
  results};
}
