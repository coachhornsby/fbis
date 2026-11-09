// Pure preparation only. Publication requires a separately admitted conditional writer.
import {projectVerifiedNflFutureGames} from './nflVerifiedProjectionInputs.js';
import {prepareNflPlayerResearch} from './nflPlayerResearchTransport.js';
import {prepareNflDirectionalResearch} from './nflDirectionalTransport.js';
import {boardDate} from './publicBoardSnapshot.js';
import {validateFourSportPacket} from './privateFourSportProjection.js';
export const NFL_VERIFIED_SOURCE_LABEL='nflverse verified current-season inputs; NFL-PRO-v1.2.1 research; no wagering';
export async function prepareVerifiedNflRecoveryPacket({date,games,publication,schedule,previousPacket=null,now=Date.now()}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))throw Error('NFL_PACKET_DATE');
 if(previousPacket){validateFourSportPacket(previousPacket,{sport:'nfl',date});if(Date.parse(previousPacket.expiresAt)<=now)throw Error('NFL_PREVIOUS_PACKET_EXPIRED_NO_RESTAMP');}
 const result=await projectVerifiedNflFutureGames({games,publication,schedule,now});
 const generatedAt=new Date(now).toISOString(),events=new Map((previousPacket?.events||[]).map(e=>[String(e.eventId),e]));
 let updates=0;
 const eventGeneratedAt={...(previousPacket?.eventGeneratedAt||{})};
 for(const e of previousPacket?.events||[])eventGeneratedAt[String(e.eventId)]??=previousPacket.generatedAt;
 for(let i=0;i<result.games.length;i++){
  const g=result.games[i];if(result.decisions[i].state!=='NFL_RESEARCH_INPUTS_APPLIED'||g.date!==date||boardDate(g.start)!==date)continue;
  updates++;
  const p=g.nflProShadow;
  events.set(String(g.id),{eventId:String(g.id),date,start:g.start,homeId:'nfl-'+g.home.espnId,awayId:'nfl-'+g.away.espnId,
   sourceCapturedAt:publication.receipt.observedAt,sourceDataCutoffAt:publication.receipt.dataThrough,
   sourceDataCutoffKind:publication.receipt.dataThroughKind,canAuthorizeWager:false,
   projection:{homeScore:p.home,awayScore:p.away,margin:p.margin,total:p.total,modelId:p.modelId,modelVersion:p.version},
   sourceLabel:NFL_VERIFIED_SOURCE_LABEL,nflVerifiedInput:g.nflVerifiedInput,nflPlayerResearch:prepareNflPlayerResearch(g),nflDirectionalResearch:prepareNflDirectionalResearch(g)});
  eventGeneratedAt[String(g.id)]=generatedAt;
 }
 if(!updates)return {packet:previousPacket,changed:false,playerResearch:[],decisions:result.decisions,storageWrites:0};
 // Never renew the previous packet's expiry or the verified source receipt age.
 const expires=Math.min(now+18*3600000,Date.parse(result.meta.sourceExpiresAt),previousPacket?Date.parse(previousPacket.expiresAt):Infinity);
 if(!Number.isFinite(expires)||expires<=now)throw Error('NFL_PACKET_SOURCE_EXPIRED');
 const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'nfl',date,generatedAt,expiresAt:new Date(expires).toISOString(),modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,eventGeneratedAt,events:[...events.values()]};
 validateFourSportPacket(packet,{sport:'nfl',date});
 if(new TextEncoder().encode(JSON.stringify(packet)).length>512000)throw Error('NFL_PACKET_TOO_LARGE');
 return {packet,changed:true,playerResearch:result.games.filter((g,i)=>result.decisions[i].state==='NFL_RESEARCH_INPUTS_APPLIED'&&g.date===date).map(g=>({eventId:String(g.id),rows:g.playerProjectionRows,status:g.playerProjectionStatus})),decisions:result.decisions,storageWrites:0};
}
