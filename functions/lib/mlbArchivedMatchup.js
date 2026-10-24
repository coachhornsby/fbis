/** Archived candidate adapter. Never changes the champion or authorizes a wager. */
import {buildStatcastProfiles,scorePitcherVsBatter} from './mlbPitchMatchup.js';
import {isActualLabPitch,isCompletedLabPa} from './mlbStatcastLab.js';
export const ARCHIVED_MATCHUP_VERSION='mlb-archived-matchup-v1';
export function buildArchivedMatchup({pitcherPackets=[],batterPackets=[],pitcherId,batterId,asOf,pitcherHand,batterHand}={}){
 if(!/^\d+$/.test(String(pitcherId))||!/^\d+$/.test(String(batterId))||!/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf||asOf>new Date().toISOString().slice(0,10)||!['L','R'].includes(pitcherHand)||!['L','R'].includes(batterHand))throw Error('INVALID_MATCHUP_SCOPE');
 const start=new Date(Date.parse(asOf)-365*86400000).toISOString().slice(0,10);
 const select=(packets,role,id)=>{
  const seen=new Set(),rows=[],sources=[];
  for(const p of packets){if(p.role!==role||String(p.playerId)!==String(id))continue;
   sources.push({season:p.season,sourceHash:p.sourceHash,observedAt:p.observedAt});
   for(const r of p.rows||[]){if(String(r[role])!==String(id)||r.game_date<start||r.game_date>=asOf||!['R','F','D','L','W'].includes(r.game_type))continue;
    if(role==='pitcher'&&r.stand!==batterHand||role==='batter'&&r.p_throws!==pitcherHand)continue;
    const key=`${r.game_pk}:${r.at_bat_number}:${r.pitch_number}`;if(seen.has(key))continue;seen.add(key);
    // Automatic terminal walks retain PA evidence, but are not actual pitch observations.
    rows.push({...r,events:isCompletedLabPa(r)?r.events:''});
   }
  }
  const actual=rows.filter(isActualLabPitch);
  const profile=buildStatcastProfiles(actual,{role,asOf,halfLifeDays:45})[String(id)];
  if(profile){const terminals=new Map();for(const r of rows)if(r.events)terminals.set(`${r.game_pk}:${r.at_bat_number}`,r);let denominator=0,numerator=0;for(const r of terminals.values()){const w=2**(-((Date.parse(asOf)-Date.parse(r.game_date))/86400000)/45);denominator+=w;if(['strikeout','strikeout_double_play'].includes(r.events))numerator+=w;}profile.kRate=denominator?numerator/denominator:null;profile.plateAppearances=terminals.size;}
  return {profile,pitches:actual.length,plateAppearances:profile?.plateAppearances||0,sources};
 };
 const pitcher=select(pitcherPackets,'pitcher',pitcherId),batter=select(batterPackets,'batter',batterId);
 const reasons=[];if(pitcher.pitches<200||pitcher.plateAppearances<50)reasons.push('PITCHER_SAMPLE');if(batter.pitches<200||batter.plateAppearances<50)reasons.push('BATTER_SAMPLE');
 const candidate=reasons.length?null:scorePitcherVsBatter(pitcher.profile,batter.profile);
 return {version:ARCHIVED_MATCHUP_VERSION,status:candidate?'CANDIDATE':'INSUFFICIENT_SAMPLE',asOf,windowStart:start,pitcherId:String(pitcherId),batterId:String(batterId),pitcherHand,batterHand,candidate,reasons,coverage:{pitcher:{pitches:pitcher.pitches,plateAppearances:pitcher.plateAppearances,sources:pitcher.sources},batter:{pitches:batter.pitches,plateAppearances:batter.plateAppearances,sources:batter.sources}},canAuthorizeWager:false,productionProjectionChanged:false,limitations:['Candidate uses existing research matchup coefficients and fixed reference rates; it is not calibrated.','Rows on or after asOf are excluded; later-acquired archives are retrospective data, not proof of historical availability.','No lineup position, projected plate appearances, bullpen, park, or hit/HR/total-base probability model is supplied.']};
}
