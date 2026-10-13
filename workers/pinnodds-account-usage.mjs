/** Non-chargeable account capability read with the existing encrypted provider key. */
const ENDPOINT='https://mcp.pinnodds.com/mcp';
function decode(raw){try{return JSON.parse(raw)}catch{for(const line of raw.split('\n'))if(line.startsWith('data:')){try{const message=JSON.parse(line.slice(5));if(message.result||message.error)return message;}catch{}}}throw Error('ACCOUNT_RESPONSE_CONTRACT_CHANGED');}
function scrub(value,key){
 if(typeof value==='string')return value.split(key).join('[redacted]');
 if(Array.isArray(value))return value.map(v=>scrub(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>!/api.?key|token|secret|authorization|cookie|email|phone|^name$|user.?name|full.?name|first.?name|last.?name|address/i.test(name)).map(([name,v])=>[name,scrub(v,key)]));
 return value;
}
export async function readPinnoddsAccountUsage({apiKey,fetchImpl=fetch}={}){
 if(!apiKey)throw Error('PINNODDS_KEY_UNCONFIGURED');let session=null;
 async function request(method,params,id){
  const response=await fetchImpl(ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json',accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26',...(session?{'Mcp-Session-Id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',...(id?{id}:{}),method,params}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('PINNODDS_ACCOUNT_HTTP_'+response.status);
  session=response.headers.get('mcp-session-id')||session;
  if(!id)return null;
  const message=decode(await response.text());if(message.error)throw Error('PINNODDS_ACCOUNT_PROTOCOL_ERROR');return message.result;
 }
 await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fbis-capability-audit',version:'1'}},1);
 await request('notifications/initialized',{},null);
 const result=await request('tools/call',{name:'get_account_usage',arguments:{}},2);
 if(result?.isError)throw Error('PINNODDS_ACCOUNT_READ_FAILED');
 let usage=result?.structuredContent||null;
 if(!usage){const content=(result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');try{usage=JSON.parse(content)}catch{usage={providerText:content}}}
 return{ok:true,version:'pinnodds-account-usage-v1',capturedAt:new Date().toISOString(),usage:scrub(usage,apiKey),
  operation:'get_account_usage',chargeableOddsRequests:0,readOnly:true,canAuthorizeWager:false};
}
