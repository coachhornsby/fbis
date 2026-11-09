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
export function balancedCbbCandidates(candidates,{eventRotation=0,priorityEventIds=[]}={}){
 const events=new Map();
 for(const row of candidates){
  const key=row.displayBinding.period+':'+row.market_family;
  if(!families.includes(key))continue;
  if(!events.has(row.canonical_event_id))events.set(row.canonical_event_id,new Map(families.map(f=>[f,[]])));
  events.get(row.canonical_event_id).get(key).push(row);
 }
 // First diversify families within each event, then events within the roster.
 let groups=[...events.entries()],priorityRows=[];
 const priority=new Set(priorityEventIds);
 if(candidates.length>50){
  // Reserving a detail request is useful only if its verified family
  // representatives survive the output cap, not just that event's moneyline.
  priorityRows=groups.filter(([id])=>priority.has(id)).flatMap(([,buckets])=>
   [...buckets.values()].filter(rows=>rows.length).map(rows=>rows[0]));
  priorityRows=[...new Map(priorityRows.map(row=>[row.source_market_id,row])).values()].slice(0,50);
  const reserved=new Set(priorityRows.map(row=>row.source_market_id));
  groups=groups.map(([id,buckets])=>[id,new Map([...buckets].map(([family,rows])=>
   [family,rows.filter(row=>!reserved.has(row.source_market_id))]))]);
 }
 const remaining=50-priorityRows.length;
 if(groups.length>remaining){
  const first=groups.filter(([id])=>priority.has(id)),rest=groups.filter(([id])=>!priority.has(id));
  const offset=rest.length?(eventRotation*Math.max(1,remaining-first.length))%rest.length:0;
  groups=[...first,...rest.slice(offset),...rest.slice(0,offset)];
 }
 return [...priorityRows,...roundRobin(groups.map(([,buckets])=>roundRobin([...buckets.values()],50)),remaining)];
}

// Detail opportunities alternate source pages, not just low-sorting slugs from
// the fixed first pages. Deduplicate exact slugs before interleaving queues.
export function balancedDetailEvents(pages){
 const seen=new Set();
 const groups=pages.map(events=>[...events].sort((a,b)=>a.slug.localeCompare(b.slug)).filter(e=>{
  if(seen.has(e.slug))return false;seen.add(e.slug);return true;
 }));
 return roundRobin(groups,groups.reduce((n,rows)=>n+rows.length,0));
}
