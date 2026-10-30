import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {POLY_FIXTURE_JOB} from '../../services/account-budget/executionJobs.mjs';
import {ROSTER_SPORTS} from './boundedPolymarketRoster.js';
import {classifyPolymarketUsLeague} from './polymarketUs.js';
export const fixtureKey=sport=>'market-sources/polymarket-us/fixtures-v1/'+sport+'.json';
export function validateFixtureManifest(value,now=Date.now()){
 if(value?.version!==1||value.source!=='FBIS_COLLECTED_SLATE'||!ROSTER_SPORTS.includes(value.sport)||!Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)>now||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=now||Date.parse(value.expiresAt)>Date.parse(value.capturedAt)+3600000||!Array.isArray(value.providerTags)||!value.providerTags.length||value.providerTags.length>2||!Array.isArray(value.fixtures)||value.fixtures.length>100)throw Error('INVALID_OR_STALE_FIXTURE_MANIFEST');
 if(new Set(value.providerTags).size!==value.providerTags.length)throw Error('DUPLICATE_PROVIDER_TAG');
 for(const tag of value.providerTags)if(typeof tag!=='string'||!/^[a-z0-9-]{1,80}$/.test(tag)||classifyPolymarketUsLeague({slug:tag})!==value.sport)throw Error('INVALID_PROVIDER_TAG_SCOPE');
 const ids=new Set();
 const fixtures=value.fixtures.map(g=>{
  if(typeof g.id!=='string'||!g.id.length||g.id.length>160||ids.has(g.id)||g.sport!==value.sport||!Number.isFinite(Date.parse(g.start))||Math.abs(Date.parse(g.start)-now)>72*3600000||typeof g.home_name!=='string'||!g.home_name.trim()||g.home_name.length>160||typeof g.away_name!=='string'||!g.away_name.trim()||g.away_name.length>160||g.home_name===g.away_name)throw Error('INVALID_FIXTURE_IDENTITY');
  ids.add(g.id);return {id:g.id,sport:g.sport,start:g.start,home_name:g.home_name,away_name:g.away_name,...(typeof g.home_abbr==='string'?{home_abbr:g.home_abbr.slice(0,12)}:{}),...(typeof g.away_abbr==='string'?{away_abbr:g.away_abbr.slice(0,12)}:{}),...(g.tour?{tour:String(g.tour).slice(0,8)}:{})};
 });
 return {...value,fixtures};
}
export async function archiveCollectedFixtures(env,{sport,games,now=Date.now()}={}){
 let config;try{config=JSON.parse(env.FBIS_POLYMARKET_TAGS_JSON||'{}');}catch{throw Error('INVALID_PROVIDER_TAG_CONFIG');}
 const tags=config[sport];if(!Array.isArray(tags)||!tags.length)return {ok:false,code:'PROVIDER_TAGS_NOT_CONFIGURED'};
 if(!Array.isArray(games)||games.length>500)throw Error('FIXTURE_BATCH_LIMIT');
 const unique=new Map();for(const g of games){if(g.sport!==sport)continue;unique.set(String(g.id),{id:String(g.id),sport,start:g.start,home_name:g.home?.fullName||g.home?.name||g.home_name,away_name:g.away?.fullName||g.away?.name||g.away_name,home_abbr:g.home?.abbr||g.home_abbr,away_abbr:g.away?.abbr||g.away_abbr,tour:g.tour||g.tennisProjection?.tour});}
 const relevant=[...unique.values()].filter(g=>Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)>=now-48*3600000&&Date.parse(g.start)<=now+72*3600000);
 if(relevant.length>100)throw Error('FIXTURE_MANIFEST_CAPACITY');
 const manifest=validateFixtureManifest({version:1,source:'FBIS_COLLECTED_SLATE',sport,capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),providerTags:tags,fixtures:relevant,canQualify:false,canAuthorizeWager:false},now);
 env=await beginJobExecution(env,POLY_FIXTURE_JOB);
 const prior=await env.ARCHIVE.head(fixtureKey(sport));
 if(prior){const old=await env.ARCHIVE.get(fixtureKey(sport));const current=await old.json();if(Date.parse(current.capturedAt)>now)throw Error('OLDER_FIXTURE_PUBLICATION');}
 const saved=await env.ARCHIVE.put(fixtureKey(sport),JSON.stringify(manifest),{onlyIf:prior?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'}});
 if(!saved)throw Error('FIXTURE_PUBLICATION_CONFLICT');
 return {ok:true,sport,fixtures:manifest.fixtures.length,canQualify:false,canAuthorizeWager:false};
}
