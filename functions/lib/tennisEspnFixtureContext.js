import {espnCountry} from "./tennisPrizePicksResearch.js";

const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const flagCountry=a=>{
 const url=String(a?.flag?.href||"");
 const code=/\/([a-z]{2,3})\.png(?:\?|$)/i.exec(url)?.[1]?.toUpperCase();
 return code?espnCountry({citizenshipCountry:code}):null;
};
/** A separately labeled read of the existing ESPN source payload.
 * It cannot create ATP_OFFICIAL schedule authority or authorize wagers.
 */
export async function readEspnFixtureResearchContext(archive,fixture,{cache=new Map()}={}){
 const key=String(fixture?.raw_key||"");
 if(!archive?.get||!key.startsWith("tennis/external-fixtures/espn/raw/")||
    fixture?.source!=="ESPN_PUBLIC"||
    !fixture?.source_event_id||!fixture?.source_competition_id)return null;
 let snapshot;
 if(cache.has(key))snapshot=cache.get(key);
 else{
  try{const file=await archive.get(key);snapshot=file?await file.json():null}
  catch{snapshot=null}
  cache.set(key,snapshot);
 }
 const event=snapshot?.events?.find(e=>String(e.id)===String(fixture.source_event_id));
 if(!event)return null;
 const matches=(event.groupings||[]).flatMap(g=>Array.isArray(g.competitions)?g.competitions:[]);
 const candidates=matches.filter(c=>String(c.id)===String(fixture.source_competition_id));
 if(candidates.length!==1)return null;
 const match=candidates[0];
 const athletes=(match.competitors||[]).map(c=>c.athlete).filter(Boolean);
 const requested=[norm(fixture.away_name),norm(fixture.home_name)].sort();
 if(athletes.length!==2||requested.some((name,i)=>[...athletes.map(a=>norm(a.fullName||a.displayName))].sort()[i]!==name))
  return null;
 const flags=Object.fromEntries(athletes.map(a=>[norm(a.fullName||a.displayName),flagCountry(a)]));
 const observed=fixture.fetched_at;
 return {
  source:"ESPN_PUBLIC_RESEARCH",sourceEventId:String(event.id),sourceCompetitionId:String(match.id),
  observedAt:observed,rawKey:key,
  tournament:String(event.name||"").trim()||null,
  venue:String(match.venue?.fullName||event.venue?.displayName||"").trim()||null,
  court:String(match.venue?.court||"").trim()||null,
  round:String(match.round?.displayName||"").trim()||null,
  providerStatus:String(match.status?.type?.detail||match.status?.type?.description||"").trim()||null,
  countryByName:flags,
  surface:null, // ESPN event receipt does not prove playing surface.
  canQualify:false,canAuthorizeWager:false,officialEventVerified:false,
 };
}
