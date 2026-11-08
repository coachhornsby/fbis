// Explicit click only. No automatic read, source call, refresh POST or persistence.
export async function loadPrivateTorvik(date,{fetchFn=fetch,signal}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_DATE');
 const r=await fetchFn('/api/private/cbb/'+date+'?view=torvik',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
 if(r.status===401||r.status===403)throw Error('OWNER_SIGN_IN_REQUIRED');
 if(r.status===404)throw Error('NO_PRIVATE_TORVIK_COMPARISON');
 if(!r.ok)throw Error('PRIVATE_TORVIK_UNAVAILABLE');
 const cap=1024*1024;if(Number(r.headers.get('content-length')||0)>cap||!r.body?.getReader)throw Error('PRIVATE_TORVIK_TOO_LARGE');
 const reader=r.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>cap)throw Error('PRIVATE_TORVIK_TOO_LARGE');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}

 const v=JSON.parse(text),p=v.packet;
 if(v.state!=='PRIVATE_TORVIK_COMPARISONS'||v.date!==date||p?.scope!=='PRIVATE_TORVIK_COMPARISONS'||p.date!==date||p.canAuthorizeWager!==false||!Array.isArray(p.events)||p.events.length>1000)throw Error('INVALID_PRIVATE_TORVIK_RESPONSE');
 return p;
}
