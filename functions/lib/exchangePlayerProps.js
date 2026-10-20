import { readCache, writeCache } from './cache.js';
import { selectivePropRating, estimatedPropHitProbability } from './selectivePropEdge.js';
const API='https://external-api.kalshi.com/trade-api/v2';
const number=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const norm=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const sports={nfl:/^KXNFL/,cfb:/^KXNCAAF/,nba:/^KXNBA/,wnba:/^KXWNBA/,nhl:/^KXNHL/,mlb:/^KXMLB/,cbb:/^KXNCAAMB/};
export function exchangeSeriesMarket(series,sport){
 if(!sports[sport]?.test(series.ticker)||/SEASON|CAREER|TEAM|LADDER|ESCALATOR|PROT|RECORD|MOST|H2H|1H|1Q/.test(series.ticker))return null;
 const text=norm(series.title);
 for(const [regex,market] of [[/passing yards/,'passing_yards'],[/rushing yards/,'rushing_yards'],[/receiving yards/,'receiving_yards'],[/passing completions/,'completions'],[/passing attempts/,'passing_attempts'],[/player receptions/,'receptions'],[/shots on goal/,'shots_on_goal'],[/goalie saves/,'saves'],[/pitcher strikeouts/,'strikeouts'],[/player points/,'points'],[/player rebounds/,'rebounds'],[/player assists/,'assists']])if(regex.test(text))return market;
 return null;
}
export function kalshiEventMatches(market,game,date){
 if(day(game.start)!==date)return false;
 const stamp=date.slice(2,4)+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(date.slice(5,7))-1]+date.slice(8,10);
 const abbr=v=>String(v||'').toUpperCase().replace(/[^A-Z]/g,'');
 const home=abbr(game.home?.abbr||game.home_abbr),away=abbr(game.away?.abbr||game.away_abbr);
 if(!home||!away)return false;
 return [stamp+away+home,stamp+home+away].includes(String(market.event_ticker||'').split('-').at(-1));
}
export function exchangeContractEconomics({ask,feePerContract,probability,depth,observedAt,now=Date.now(),calibrationValidated=false}){
 const price=number(ask),fee=number(feePerContract),p=number(probability),size=number(depth);
 const age=now-Date.parse(observedAt||'');
 const priceReady=price>0&&price<1&&size>0&&Number.isFinite(age)&&age>=0&&age<=60000;
 const cost=priceReady&&fee!=null&&fee>=0?price+fee:null;
 return {ask:price,feePerContract:fee,depth:size,priceReady,breakEvenProbability:cost,
  estimatedProfitPerContract:cost!=null&&p!=null?p-cost:null,
  profitQualified:priceReady&&cost!=null&&p!=null&&calibrationValidated===true&&p>cost,
  status:!priceReady?'QUOTE_OR_DEPTH_UNVERIFIED':fee==null?'FEE_UNVERIFIED':!calibrationValidated?'MODEL_PROBABILITY_UNVALIDATED':p>cost?'POSITIVE_ESTIMATED_EDGE':'NO_POSITIVE_EDGE'};
}
export function binaryKalshiRows(m,series,candidates,game,date,capturedAt){
 if(!kalshiEventMatches(m,game,date)||m.market_type!=='binary'||!['greater','less'].includes(m.strike_type)||!['active','open'].includes(m.status))return[];
 // Scalar ladders, protected contracts, combos and unfamiliar settlement rules
 // must never inherit $1 binary settlement math.
 if(m.mve_collection_ticker||m.custom_strike?.scalar_payout_type||/scalar|protected|ladder|escalator/i.test(m.title||''))return[];
 const market=exchangeSeriesMarket(series,game.sport);if(!market)return[];
 const names=norm([m.title,m.yes_sub_title,m.no_sub_title].join(' '));
 const matches=candidates.filter(p=>(p.market===market||p.canonical_market===market)&&norm(p.playerName||p.player_name).length>5&&(' '+names+' ').includes(' '+norm(p.playerName||p.player_name)+' '));
 const players=[...new Set(matches.map(p=>norm(p.playerName||p.player_name)))];if(players.length!==1)return[];
 const p=matches[0],strike=number(m.strike_type==='greater'?m.floor_strike:m.cap_strike);if(strike==null)return[];
 const line=m.strike_type==='greater'?Math.floor(strike)+.5:Math.ceil(strike)-.5;
 const projection=number(p.fbisProjection??p.fbis_projection),sigma=number(p.fbisSigma??p.fbis_sigma);
 if(projection==null)return[];
 const more=projection>line;const yesIsMore=m.strike_type==='greater';const side=more===yesIsMore?'yes':'no';
 const ask=number(m[side+'_ask_dollars']),depth=number(m[side+'_ask_size_fp']??(side==='no'?m.yes_bid_size_fp:null));
 // Unknown series fee schedules remain unknown; do not apply a guessed flat fee.
 const fee=series.fee_type==='quadratic'&&number(series.fee_multiplier)!=null&&ask>0&&ask<1?Math.ceil((ask+.07*Number(series.fee_multiplier)*ask*(1-ask))*10000-1e-9)/10000-ask:null;
 const row={...p,sport:game.sport,eventId:String(game.id),fbis_event_id:String(game.id),player_name:p.playerName||p.player_name,canonical_market:market,market,line,
  fbisProjection:projection,fbis_projection:projection,fbisSigma:sigma,fbis_sigma:sigma,featureEvidence:p.featureEvidence||{},
  executionVenue:'Kalshi',venue:'Kalshi',odds_tier:'standard',duration:'full',candidate_side:more?'MORE':'LESS',
  team:p.team||'',opponent:p.opponent||'',start_time:game.start,collected_at:capturedAt,sourceMarketId:m.ticker,contractSide:side.toUpperCase(),contractRules:m.rules_primary||null};
 const rating=selectivePropRating(row);
 return [{...row,confidence_stars:rating.stars,ratingExplanation:rating,contractEconomics:exchangeContractEconomics({ask,depth,feePerContract:fee,probability:estimatedPropHitProbability(row),observedAt:capturedAt,calibrationValidated:false}),canQualify:false,canAuthorizeWager:false}];
}
async function json(fetchImpl,url){const r=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Kalshi HTTP '+r.status);return r.json();}
export async function loadKalshiPlayerProps(games,{date,caches,fetchImpl=fetch}={}){
 let catalog=await readCache('kalshi-prop-series-v1',caches,900000);
 if(!catalog){catalog=(await json(fetchImpl,API+'/series?category=Sports')).series||[];await writeCache('kalshi-prop-series-v1',catalog,caches,900000);}
 const plans=[];
 for(const series of catalog){const sport=[...new Set(games.map(g=>g.sport))].find(s=>exchangeSeriesMarket(series,s));if(!sport)continue;
  if(games.some(g=>g.sport===sport&&(g.playerProjectionRows||[]).some(p=>p.market===exchangeSeriesMarket(series,sport))))plans.push({series,sport});}
 const rows=[],errors=[];let truncated=plans.length>16;
 for(let i=0;i<Math.min(plans.length,16);i+=4){await Promise.all(plans.slice(i,i+4).map(async({series,sport})=>{try{
  const key='kalshi-props-v1:'+series.ticker;let pack=await readCache(key,caches,30000);
  if(!pack){const body=await json(fetchImpl,API+'/markets?status=open&limit=200&series_ticker='+encodeURIComponent(series.ticker));pack={markets:body.markets||[],capturedAt:new Date().toISOString(),truncated:Boolean(body.cursor)};await writeCache(key,pack,caches,30000);}
  truncated ||= pack.truncated;
  for(const market of pack.markets){const matching=games.filter(g=>g.sport===sport&&kalshiEventMatches(market,g,date));if(matching.length!==1)continue;rows.push(...binaryKalshiRows(market,series,matching[0].playerProjectionRows||[],matching[0],date,pack.capturedAt));}
 }catch(e){errors.push({series:series.ticker,error:String(e.message)});}}));}
 return {rows,coverage:{source:'Kalshi',seriesChecked:Math.min(plans.length,16),truncated,errors,contracts:rows.length}};
}

export function polymarketPropRow(observation,games,{now=Date.now()}={}){
 if(!observation.source_market_id)return null;
 const game=games.find(g=>String(g.id)===String(observation.canonical_event_id));if(!game||!['full','full_game'].includes(observation.period))return null;
 const candidates=(game.playerProjectionRows||[]).filter(p=>norm(p.playerName)===norm(observation.player_name)&&p.market===observation.stat_family);
 if(candidates.length!==1||number(observation.line)==null||!['over','under'].includes(String(observation.side).toLowerCase()))return null;
 let raw={};try{raw=JSON.parse(observation.raw_payload_json||'{}')}catch{}
 const p=candidates[0],projection=number(p.fbisProjection),line=number(observation.line);if(projection==null)return null;
 const side=String(observation.side).toLowerCase(),row={...p,sport:game.sport,venue:'Polymarket US',executionVenue:'Polymarket US',sourceMarketId:observation.source_market_id,contractSide:side.toUpperCase(),fbis_event_id:String(game.id),eventId:String(game.id),player_name:p.playerName,canonical_market:p.market,market:p.market,line,fbis_projection:projection,fbis_sigma:p.fbisSigma,odds_tier:'standard',duration:'full',start_time:game.start,collected_at:observation.collected_at,candidate_side:side==='over'?'MORE':'LESS'};
 const rating=selectivePropRating(row);
 const offers=Array.isArray(raw.offers)?raw.offers:[];const first=offers.find(x=>number(x.price??x.px?.value)>0&&number(x.quantity??x.qty)>0);
 return {...row,confidence_stars:rating.stars,ratingExplanation:rating,contractEconomics:exchangeContractEconomics({ask:first?.price??first?.px?.value,depth:first?.quantity??first?.qty,feePerContract:raw.feePerContract,observedAt:observation.source_observed_at,now,calibrationValidated:false}),canQualify:false,canAuthorizeWager:false};
}
