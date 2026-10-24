import {sha256Hex} from './sha256Hex.js';
import {buildStatcastProfiles,buildLineupMatchup} from './mlbPitchMatchup.js';
import {selectMlbFeatureRows} from './mlbModelFeatures.js';
import {isActualLabPitch,isCompletedLabPa,MLB_STATCAST_LAB_CALC_VERSION} from './mlbStatcastLab.js';
/** Source acquisition must precede both capture time and first pitch. */
export function archiveProjectionProfile({packets,playerId,role,gameStart,now=new Date().toISOString()}){
 const start=Date.parse(gameStart),capture=Date.parse(now);
 if(!Number.isFinite(start)||!Number.isFinite(capture)||capture>=start)return null;
 const selected=selectMlbFeatureRows({packets,playerId,role,capturedAt:now});
 const lineage={version:'mlb-archive-profile-lineage-v2',calculationVersion:MLB_STATCAST_LAB_CALC_VERSION,playerId:String(playerId),role,capturedAt:now,windowDays:90,halfLifeDays:45,sources:selected.sources};
 const evidence={...lineage,evidenceHash:sha256Hex(JSON.stringify(lineage))};
 if(!evidence.sources.length||evidence.sources.some(s=>Date.parse(s.observedAt)>=start||capture-Date.parse(s.observedAt)>48*3600000&&s.season===Number(now.slice(0,4))))return null;
 const from=Date.parse(selected.day)-90*86400000,rows=selected.rows.filter(r=>Date.parse(r.game_date)>=from);
 const actual=rows.filter(isActualLabPitch),terminal=new Map();
 for(const r of rows)if(isCompletedLabPa(r))terminal.set(`${r.game_pk}:${r.at_bat_number}`,r);
 if(actual.length<200||terminal.size<50)return null;
 const profile=buildStatcastProfiles(actual,{role,asOf:now,halfLifeDays:45})[String(playerId)];
 if(!profile)return null;
 let den=0,num=0;for(const r of terminal.values()){const weight=2**(-((capture-Date.parse(r.game_date))/86400000)/45);den+=weight;if(['strikeout','strikeout_double_play'].includes(r.events))num+=weight;}
 return {...profile,kRate:den?num/den:null,plateAppearances:terminal.size,featureEvidence:{version:lineage.version,calculationVersion:lineage.calculationVersion,hash:evidence.evidenceHash,capturedAt:now,sources:evidence.sources,pitches:actual.length,plateAppearances:terminal.size}};
}
export function archiveLineupMatchup({pitcherProfile,batterProfiles,pitcherId,batterIds,expectedInnings,battersFacedPerInning}){
 if(!pitcherProfile||batterIds.length<5||batterIds.length>9||batterProfiles.length!==batterIds.length)return null;
 const result=buildLineupMatchup({pitcherProfile,batterProfiles,expectedInnings,battersFacedPerInning});
 return result?{...result,pitcherId,batterIds,batterProfiles:batterProfiles.length,source:'MLB_VERIFIED_ARCHIVE_STATCAST',featureEvidence:[pitcherProfile,...batterProfiles].map(p=>p.featureEvidence),marketInformed:false}:null;
}

/** Reuse verified player features in the existing prop engine; preserve workload and official season rates. */
export function withArchivePlayerProfiles(persistent,overrides={}){
 const byGameId={...persistent.byGameId};
 for(const [key,sides] of Object.entries(overrides)){
  const state=byGameId[key];if(!state?.fresh)continue;
  const next={...state,hitters:{...state.hitters},teamHitters:{home:{...state.teamHitters?.home},away:{...state.teamHitters?.away}}};
  for(const side of ['home','away']){
   const data=sides[side];if(!data)continue;
   const starter=side+'Starter';next[starter]={...state[starter],statcastProfile:data.pitcherProfile};
   const opponent=side==='home'?'away':'home';
   for(let i=0;i<data.matchup.batterIds.length;i++){
    const id=String(data.matchup.batterIds[i]),existing=state.hitters?.[id]||state.teamHitters?.[opponent]?.[id];
    if(!existing)continue;
    const updated={...existing,statcastProfile:data.batterProfiles[i]};
    next.hitters[id]=updated;next.teamHitters[opponent][id]=updated;
   }
  }
  byGameId[key]=next;
 }
 return {...persistent,byGameId};
}
