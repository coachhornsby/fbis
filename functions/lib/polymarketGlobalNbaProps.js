/** Polymarket Global Gamma: independently matched NBA props, display prices only. */
const ROOT='player-props/polymarket-global/v1/';
const abbr=x=>({NY:'NYK',SA:'SAS'}[String(x||'').toUpperCase()]||String(x||'').toUpperCase());
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const day=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const price=x=>x!=null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0&&Number(x)<1?Number(x):null;
const typeMap={Points:'points',Rebounds:'rebounds',Assists:'assists'};
const key=x=>String(x||'').toLowerCase();
const tag=g=>'nba-'+key(abbr(g.away_abbr))+'-'+key(abbr(g.home_abbr))+'-'+day(g.start);
export function verifyGlobalNbaFixture(event,game){
 if(!event||!game||event.slug!==tag(game)||!Array.isArray(event.teams)||event.teams.length!==2)return false;
 return event.teams.some(t=>t.ordering==='away'&&key(t.abbreviation)===key(abbr(game.away_abbr)))&&
  event.teams.some(t=>t.ordering==='home'&&key(t.abbreviation)===key(abbr(game.home_abbr)));
}
export function normalizeGlobalNbaProp(m,e,g,players,{capturedAt}={}){
 if(!m||!e||!g||!m.active||m.closed||!String(m.slug||'').startsWith(e.slug+'-'))return [];
 const parts=/^(.+?): (Points|Rebounds|Assists) O\/U (\d+(?:\.\d+)?)$/.exec(m.question||'');
 if(!parts||m.sportsMarketType!==typeMap[parts[2]]||!Array.isArray(players))return [];
 const playerName=parts[1],stat=typeMap[parts[2]],threshold=Number(parts[3]);
 if(!Number.isFinite(Number(m.line))||Number(m.line)!==threshold||threshold<0)return [];
 const desc=String(m.description||'');
 const expected=stat==='points'?playerName+' scores more than '+threshold+' points':
  playerName+' records more than '+threshold+(stat==='rebounds'?' total rebounds':' assists');
 if(!desc.includes(expected)||!/entire game including all overtime periods/i.test(desc)||
  !/player is listed as inactive or otherwise does not take the court/i.test(desc)||
  !/market will resolve "No"/i.test(desc))return [];
 const start=Date.parse(String(m.gameStartTime||'').replace(' ','T').replace(/\+00$/,'Z'));
 if(!Number.isFinite(start)||Math.abs(start-Date.parse(g.start))>7200000)return [];
 const gameTeams=[abbr(g.away_abbr),abbr(g.home_abbr)];
 const matches=players.filter(p=>norm(p.player_name)===norm(playerName)&&gameTeams.includes(abbr(p.team_key)));
 const ids=[...new Set(matches.map(p=>String(p.player_id)))];
 if(ids.length!==1||!ids[0])return [];
 let outcomes,prices;
 try{outcomes=typeof m.outcomes==='string'?JSON.parse(m.outcomes):m.outcomes;
  prices=typeof m.outcomePrices==='string'?JSON.parse(m.outcomePrices):m.outcomePrices;
 }catch{return []}
 if(!Array.isArray(outcomes)||outcomes.join('|')!=='Yes|No'||!Array.isArray(prices)||prices.length!==2)return [];
 const values=prices.map(price);if(values.some(x=>x==null))return [];
 const athlete=matches.find(p=>String(p.player_id)===ids[0]);
 const team=abbr(athlete.team_key),opponent=gameTeams.find(x=>x!==team);
 if(!opponent)return [];
 return ['yes','no'].map((side,i)=>({
  id:'polymarket-global:'+m.slug+':'+side,provider:'Polymarket',venue:'Polymarket Global',
  source:'Polymarket Global Gamma',sport:'nba',canonicalEventId:String(g.id),
  canonicalPlayerId:'nba:espn:'+ids[0],providerEventId:String(e.id),
  providerPlayerId:null,contractId:String(m.slug),outcomeId:side,
  player_name:athlete.player_name,team,opponent,start_time:g.start,
  canonical_market:stat,line:threshold,side,statSide:i===0?'over':'under',period:'full_game',
  observedReferencePrice:values[i],priceKind:'DISPLAY_REFERENCE_NOT_ASK',
  collectedAt:capturedAt,observedAt:null,quoteClockStatus:'SOURCE_TIME_UNKNOWN',
  settlementTerms:desc,settlementScope:'GAMMA_NBA_FULL_GAME_OT',
  dnpSettlement:'NO_IF_INACTIVE',identityVerified:true,priceVerified:false,fresh:false,
  marketAvailable:false,purchaseAsk:null,observedAsk:null,executableSize:null,
  fbis_projection:null,modelStatus:'UNMODELED',fees:null,expectedReturn:null,
  reasons:['GAMMA_DISPLAY_PRICE_NOT_BEST_ASK','QUOTE_CLOCK_UNKNOWN','DNP_SETTLEMENT_DIFFERS_FROM_KALSHI',
   'MODEL_UNAVAILABLE','FEES_UNVERIFIED'],canQualify:false,executionEligible:false,canAuthorizeWager:false
 }));
}
export async function capturePolymarketGlobalNba(env,{now=new Date(),fetchImpl=fetch}={}){
 if(!env?.ARCHIVE?.put||!env?.DB?.prepare)return {ok:false,code:'STORAGE_UNBOUND'};
 const today=day(now),capturedAt=now.toISOString();
 const games=(await env.DB.prepare("SELECT id,date,start,home_abbr,away_abbr FROM games WHERE sport='nba' AND date=? ORDER BY start LIMIT 8").bind(today).all()).results||[];
 const players=(await env.DB.prepare("SELECT player_id,player_name,team_key FROM nba_player_state_profiles WHERE julianday(as_of)>=julianday(?) LIMIT 1500").bind(new Date(now.getTime()-14*86400000).toISOString()).all()).results||[];
 const rows=[],errors=[],fixtures=[];
 for(const g of games){
  const kickoff=Date.parse(g.start||'');
  if(!Number.isFinite(kickoff)||kickoff<now.getTime()-3*3600000||kickoff>now.getTime()+48*3600000)continue;
  const slug=tag(g);
  try{
   const url='https://gamma-api.polymarket.com/events?slug='+encodeURIComponent(slug)+'&limit=1';
   const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(16000)});
   if(!response.ok){errors.push({slug,code:'PROVIDER_HTTP_'+response.status});continue}
   const data=await response.json(),event=Array.isArray(data)&&data.length===1?data[0]:null;
   if(!verifyGlobalNbaFixture(event,g)){errors.push({slug,code:'EVENT_IDENTITY_UNRESOLVED'});continue}
   let count=0;
   for(const market of event.markets||[]){const found=normalizeGlobalNbaProp(market,event,g,players,{capturedAt});rows.push(...found);count+=found.length;}
   fixtures.push({slug,canonicalEventId:String(g.id),providerEventId:String(event.id),providerMarkets:event.markets?.length||0,statSides:count});
  }catch{errors.push({slug,code:'PROVIDER_OR_SCHEMA_UNAVAILABLE'})}
 }
 const result={ok:true,source:'POLYMARKET_GLOBAL_GAMMA',day:today,capturedAt,rows,fixtures,errors,
  prices:'GAMMA_DISPLAY_REFERENCE_NOT_ORDERBOOK_ASK',canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(ROOT+'nba-'+today+'.json',JSON.stringify(result),{httpMetadata:{contentType:'application/json',cacheControl:'private,max-age=0'}});
 return {ok:true,source:result.source,day:today,capturedAt,contracts:rows.length,fixtures:fixtures.length,errors,canAuthorizeWager:false};
}
export async function loadPolymarketGlobalNba(env,{day:date,now=Date.now()}={}){
 if(!env?.ARCHIVE?.get||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return {rows:[],status:'UNAVAILABLE'};
 try{
  const obj=await env.ARCHIVE.get(ROOT+'nba-'+date+'.json');if(!obj)return {rows:[],status:'NOT_CAPTURED'};
  const d=await obj.json(),age=now-Date.parse(d.capturedAt||'');
  if(!Array.isArray(d.rows)||age<0||!Number.isFinite(age)||age>2*3600000)return {rows:[],status:'STALE'};
  return {rows:d.rows.filter(r=>r.identityVerified&&r.canAuthorizeWager===false&&r.venue==='Polymarket Global'),
   status:d.errors?.length?'PARTIAL':'RESEARCH_CAPTURED',capturedAt:d.capturedAt,fixtures:d.fixtures||[]};
 }catch{return {rows:[],status:'READ_FAILED'}}
}
