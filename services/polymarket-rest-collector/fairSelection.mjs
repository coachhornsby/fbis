import {polymarketUsMarketFamily,polymarketUsPeriod} from '../../functions/lib/polymarketUs.js';
const families=['full_game:moneyline','full_game:spread','full_game:total','first_half:total'];
// Ordering only: source classification never substitutes for binding validation.
function roundRobin(groups,limit){
 const queues=groups.map(rows=>[...rows]),out=[];
 while(out.length<limit&&queues.some(rows=>rows.length))for(const rows of queues){if(rows.length)out.push(rows.shift());if(out.length===limit)break;}
 return out;
}
export function balancedCbbMarkets(markets){
 const buckets=new Map(families.map(key=>[key,[]]));
 for(const market of markets){const key=polymarketUsPeriod(market)+':'+polymarketUsMarketFamily(market);buckets.get(key)?.push(market);}
 return roundRobin([...buckets.values()],24);
}
export function balancedCbbCandidates(candidates){
 const events=new Map();
 for(const row of candidates){
  const key=row.displayBinding.period+':'+row.market_family;
  if(!families.includes(key))continue;
  if(!events.has(row.canonical_event_id))events.set(row.canonical_event_id,new Map(families.map(f=>[f,[]])));
  events.get(row.canonical_event_id).get(key).push(row);
 }
 // First diversify families within each event, then events within the roster.
 return roundRobin([...events.values()].map(buckets=>roundRobin([...buckets.values()],50)),50);
}
