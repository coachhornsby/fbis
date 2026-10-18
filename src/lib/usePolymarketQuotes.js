import {useEffect,useState} from 'react';
/** Lightweight expanded-card updates. Sports projections and compact-card state stay untouched. */
export function usePolymarketQuotes(game){
 const [live,setLive]=useState(null),id=String(game?.id||''),sport=String(game?.sport||'');
 useEffect(()=>{
  if(!id||!sport)return;
  let stopped=false,busy=false,controller;
  const refresh=async()=>{
   if(stopped||busy||document.visibilityState==='hidden')return;
   busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
   try{const query=new URLSearchParams({sport,eventIds:id});const r=await fetch('/api/polymarket-quotes?'+query,{signal:controller.signal});const body=await r.json();
    if(!r.ok||!body.ok)throw Error('quote-unavailable');
    if(!stopped)setLive({id,offers:body.byEvent?.[id]||[],checkedAt:body.checkedAt,error:false});
   }catch{if(!stopped)setLive(previous=>({...previous,id,error:true}));}
   finally{clearTimeout(timeout);busy=false;}
  };
  refresh();const timer=setInterval(refresh,5000);document.addEventListener('visibilitychange',refresh);
  return()=>{stopped=true;clearInterval(timer);controller?.abort();document.removeEventListener('visibilitychange',refresh);};
 },[id,sport]);
 if(!live||live.id!==id||!Array.isArray(live.offers))return {game,updateError:live?.error===true};
 return {game:{...game,market:{...game.market,venueOffers:[...(game.market?.venueOffers||[]).filter(o=>!String(o.source||'').startsWith('Polymarket US')),...live.offers]}},updateError:live.error};
}
