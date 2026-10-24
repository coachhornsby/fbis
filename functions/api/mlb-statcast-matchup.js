import {readLabPackets} from '../lib/mlbStatcastLabStore.js';
import {buildArchivedMatchup} from '../lib/mlbArchivedMatchup.js';
export async function onRequestGet({env,request}){
 const q=new URL(request.url).searchParams,scope=Object.fromEntries(['pitcherId','batterId','asOf','pitcherHand','batterHand'].map(k=>[k,q.get(k)]));
 try{
  buildArchivedMatchup(scope); // Validate before any storage reads.
  const year=Number(scope.asOf.slice(0,4)),seasons=[year-1,year].filter(y=>y>=2024);
  const [pitcher,batter]=await Promise.all([readLabPackets(env,{playerId:scope.pitcherId,role:'pitcher',seasons}),readLabPackets(env,{playerId:scope.batterId,role:'batter',seasons})]);
  return Response.json({ok:true,...buildArchivedMatchup({...scope,pitcherPackets:pitcher.packets,batterPackets:batter.packets}),diagnostics:{pitcher:pitcher.diagnostics,batter:batter.diagnostics}},{headers:{'cache-control':'public,max-age=300'}});
 }catch(e){const invalid=e.message==='INVALID_MATCHUP_SCOPE';return Response.json({ok:false,error:invalid?e.message:'Matchup archive unavailable'},{status:invalid?400:503});}
}
