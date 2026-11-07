// Accept source-supplied game destinations only. Never construct a website URL
// from a market slug: market and event identities are different in Polymarket US.
const sports=new Set(['cfb','cbb','nfl','nba','mlb','nhl']);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=160?x:null;
export function validatePolymarketEventNavigation(value,binding={}){
 if(!value||value.version!==1||value.source!=='PROVIDER_EVENT_URL')return null;
 const {sport,providerEventId,eventSlug,canonicalEventId,eventStart,url}=value;
 if(!sports.has(sport)||!text(providerEventId)||!text(canonicalEventId)||
  !text(eventSlug)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventSlug)||
  typeof eventStart!=='string'||!Number.isFinite(Date.parse(eventStart))||
  typeof url!=='string'||url.length>512)return null;
 for(const key of ['sport','providerEventId','canonicalEventId'])
  if(binding[key]!=null&&binding[key]!==value[key])return null;
 if(binding.eventStart!=null&&Date.parse(binding.eventStart)!==Date.parse(eventStart))return null;
 try{
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='polymarket.us'||u.username||u.password||u.port||u.search||u.hash||
   u.pathname!==`/sports/${sport}/${eventSlug}`||u.toString()!==url)return null;
  return {version:1,source:'PROVIDER_EVENT_URL',sport,providerEventId,eventSlug,canonicalEventId,eventStart:new Date(eventStart).toISOString(),url};
 }catch{return null;}
}
export function polymarketEventNavigationFromSource(event,{sport,canonicalEventId,eventStart}={}){
 return validatePolymarketEventNavigation({version:1,source:'PROVIDER_EVENT_URL',sport,
  providerEventId:typeof event?.id==='string'?event.id:null,eventSlug:event?.slug,
  canonicalEventId,eventStart,url:event?.eventUrl??event?.url});
}
