// Strictly source-observed, per-tier tennis performance evidence.
// This is not an inference model and must never be read by CORE wager paths.
const numeric=(value)=>{
 if(value==null || (typeof value==='string' && value.trim()===''))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
const pct=(won,points)=>points>0?Number((won/points).toFixed(6)):null;
export function addSourceMatchEvidence(bucketMap,{tier,surface,side,row,date}){
 if(!['w','l'].includes(side)||!['hard','clay','grass'].includes(surface))throw Error('INVALID_TIER_OBSERVATION');
 const other=side==='w'?'l':'w';
 const keys=['svpt','1stWon','2ndWon','ace','df'];
 const current=Object.fromEntries(keys.map(k=>[k,numeric(row[side+'_'+k])]));
 const opponent=Object.fromEntries(keys.map(k=>[k,numeric(row[other+'_'+k])]));
 // The caller rejects incomplete/invalid rows, but independently fail closed.
 if([...Object.values(current),...Object.values(opponent)].some(v=>v==null||v<0)||
  current.svpt<=0||opponent.svpt<=0||
  current['1stWon']+current['2ndWon']>current.svpt||
  opponent['1stWon']+opponent['2ndWon']>opponent.svpt)return false;
 const key=tier+'|'+surface;
 if(!bucketMap.has(key))bucketMap.set(key,{
  tier,surface,validMatches:0,servicePoints:0,servicePointsWon:0,
  returnPoints:0,returnPointsWon:0,aces:0,doubleFaults:0,
  firstMatchDate:date,lastMatchDate:date
 });
 const b=bucketMap.get(key);
 b.validMatches++;
 b.servicePoints+=current.svpt;
 b.servicePointsWon+=current['1stWon']+current['2ndWon'];
 b.returnPoints+=opponent.svpt;
 b.returnPointsWon+=opponent.svpt-(opponent['1stWon']+opponent['2ndWon']);
 b.aces+=current.ace;
 b.doubleFaults+=current.df;
 if(date<b.firstMatchDate)b.firstMatchDate=date;
 if(date>b.lastMatchDate)b.lastMatchDate=date;
 return true;
}
export function tierEvidence(bucketMap){
 return [...bucketMap.values()].sort((a,b)=>a.tier.localeCompare(b.tier)||a.surface.localeCompare(b.surface))
  .map(b=>({
   ...b,
   servePointWinRate:pct(b.servicePointsWon,b.servicePoints),
   returnPointWinRate:pct(b.returnPointsWon,b.returnPoints),
   aceRate:pct(b.aces,b.servicePoints),
   doubleFaultRate:pct(b.doubleFaults,b.servicePoints),
   meetsThreeMatchResearchMinimum:b.validMatches>=3,
   competitionAdjustment:'NOT_ESTIMATED',
   modelEligibility:'NOT_QUALIFIED',
   projectionAuthority:false,
   sourceLicense:'CC BY-NC-SA 4.0',
  }));
}
