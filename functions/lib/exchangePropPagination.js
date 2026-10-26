/** Bounded, resumable keyset reads of exchange player-stat observations.
 * A response budget is never a source-inventory ceiling.
 * Page cursors are opaque client state, scoped to exact sport/day and binding set.
 * No market, quote or wager authority is derived from this paging layer.
 */
const SOURCES="('Kalshi','Kalshi REST','Kalshi WebSocket','Polymarket','Polymarket US','Polymarket US WebSocket')";
const PAGE_SIZE=500,MAX_STORES=30,MAX_CURSOR_CHARS=12000;
const enc=x=>btoa(JSON.stringify(x)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const dec=s=>JSON.parse(atob(s.replaceAll('-','+').replaceAll('_','/')));
export async function readExchangeObservationPage(stores,{start,end,sports,cursor=null,pageBudget=3}={}){
 if(!Array.isArray(stores)||stores.length>MAX_STORES||!Array.isArray(sports)||!sports.length||
    !Number.isInteger(pageBudget)||pageBudget<1||pageBudget>10)
  throw Error('INVALID_MARKET_READ_SCOPE');
 const scope=[start,end,...sports, ...stores.map(x=>String(x.binding))].join('|');
 if(cursor!=null&&(typeof cursor!=='string'||cursor.length>MAX_CURSOR_CHARS||!/^[A-Za-z0-9_-]+$/.test(cursor)))
   throw Error('INVALID_MARKET_READ_CURSOR');
 let state;
 try{state=cursor?dec(cursor):{v:1,scope,stores:stores.map(()=>({done:false,after:null}))};}
 catch{throw Error('INVALID_MARKET_READ_CURSOR');}
 if(state.v!==1||state.scope!==scope||!Array.isArray(state.stores)||state.stores.length!==stores.length)
   throw Error('MARKET_READ_CURSOR_SCOPE_MISMATCH');
 const rows=[],diagnostics=[];
 for(let i=0;i<stores.length;i++){
  const store=stores[i],p=state.stores[i];
  if(!p||typeof p.done!=='boolean'||p.after!=null&&(
      typeof p.after?.collected_at!=='string'||typeof p.after?.id!=='string'||
      p.after.collected_at.length>60||p.after.id.length>250))
    throw Error('INVALID_MARKET_READ_CURSOR');
  if(p.done){diagnostics.push({store:store.binding,status:'DONE',observations:0,truncated:false});continue;}
  let count=0,complete=false,last=null;
  try{
   for(let page=0;page<pageBudget;page++){
    const c=p.after;
    const query=`SELECT * FROM normalized_market_observations
      WHERE source IN ${SOURCES} AND market_family='player_prop'
       AND event_start_time >= ? AND event_start_time < ?
       AND sport IN (${sports.map(()=>'?').join(',')})
       ${c?'AND (collected_at < ? OR (collected_at = ? AND id < ?))':''}
      ORDER BY collected_at DESC,id DESC LIMIT ${PAGE_SIZE}`;
    const args=[start,end,...sports,...(c?[c.collected_at,c.collected_at,c.id]:[])];
    const batch=(await store.db.prepare(query).bind(...args).all()).results||[];
    if(!Array.isArray(batch)||batch.length>PAGE_SIZE)throw Error('INVALID_MARKET_READ_PAGE');
    rows.push(...batch);count+=batch.length;
    if(batch.length<PAGE_SIZE){complete=true;p.done=true;break;}
    const endRow=batch.at(-1);
    if(typeof endRow?.collected_at!=='string'||typeof endRow?.id!=='string')
      throw Error('UNSEEKABLE_MARKET_READ_PAGE');
    if(last?.collected_at===endRow.collected_at&&last?.id===endRow.id)
      throw Error('NONADVANCING_MARKET_READ_CURSOR');
    last={collected_at:endRow.collected_at,id:endRow.id};
    p.after=last;
   }
   diagnostics.push({store:store.binding,status:'READ',observations:count,truncated:!complete,
     cursorPresent:!complete});
  }catch{
   p.done=true;p.failed=true;
   diagnostics.push({store:store.binding,status:'READ_FAILED',observations:count,truncated:true});
  }
 }
 const more=state.stores.some(x=>!x.done),degraded=diagnostics.some(d=>d.status==='READ_FAILED');
 return {rows,diagnostics,degraded,readComplete:!more&&!degraded,
   nextCursor:more?enc(state):null,moreAvailable:more};
}
