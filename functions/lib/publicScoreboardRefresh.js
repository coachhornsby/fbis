// Browser-only public score polling. No backend, database or paid API operations.
export const SCORE_REFRESH_MS=60_000;
export function startScoreboardPolling({refresh,isVisible,isBusy,lastAttempt,now=Date.now,setTimer=setInterval,clearTimer=clearInterval,listen}){
 let stopped=false;
 const tick=()=>{if(!stopped&&isVisible()&&!isBusy()&&now()-lastAttempt()>=SCORE_REFRESH_MS)refresh();};
 const timer=setTimer(tick,SCORE_REFRESH_MS);const unlisten=listen?.(tick);
 return ()=>{stopped=true;clearTimer(timer);unlisten?.();};
}
export function retainFailedScoreFeeds(live,previous){
 if(!previous||previous.date!==live.date)return live;
 const games=[...live.games],feeds={...live.feeds};
 for(const [sport,feed] of Object.entries(feeds))if(!feed.ok){
  const retained=previous.games.filter(g=>g.sport===sport);
  if(retained.length||previous.feeds[sport]?.capturedAt){
   for(let i=games.length-1;i>=0;i--)if(games[i].sport===sport)games.splice(i,1);
   games.push(...retained);feeds[sport]={...feed,capturedAt:previous.feeds[sport]?.capturedAt||null,usingSavedCapture:true};
  }
 }
 return {...live,games,feeds};
}
