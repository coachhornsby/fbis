/**
 * FBIS private read-only account MCP gateway.
 * Manual ChatGPT tool invocation only. No schedules, no D1/R2, no writes, no
 * calls to a trading endpoint. Upstream account readers already sanitize data.
 * Provider signing credentials remain on existing FBIS Pages Functions.
 */
const TARGETS = Object.freeze({
  polymarket: { path: '/polymarket/mcp', url: 'https://fbis-myz.pages.dev/api/polymarket-account', name: 'fbis_polymarket_us_account', auth: 'FBIS_POLYMARKET_MCP_TOKEN_SHA256', sections: ['summary','positions','trades','orders','balances'] },
  kalshi: { path: '/kalshi/mcp', url: 'https://fbis-myz.pages.dev/api/kalshi-account', name: 'fbis_kalshi_account', auth: 'FBIS_KALSHI_MCP_TOKEN_SHA256', sections: ['summary','positions','trades','orders','balances'] },
});
const responseHeaders = {'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store, max-age=0', 'x-content-type-options':'nosniff', 'x-robots-tag':'noindex, nofollow'};
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:responseHeaders});
const result=(id,value)=>json({jsonrpc:'2.0',id,result:value});
const error=(id,code,message)=>json({jsonrpc:'2.0',id,error:{code,message}});
const content=(data,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(data)}]});
function toolsFor(provider){
  const t=TARGETS[provider];
  const read={name:t.name,description:`Read only YOUR authenticated ${provider==='polymarket'?'Polymarket US':'Kalshi'} account: positions, trades/fills, open orders, balances. Never places, modifies or cancels trades. Returns source timestamp and completeness; this is account data, not public market quotes.`,inputSchema:{type:'object',properties:{section:{type:'string',enum:t.sections,description:'Which read-only portion of the account snapshot to return.'},offset:{type:'integer',minimum:0,maximum:1000},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}};
  const status={name:`fbis_${provider}_account_connection_status`,description:'Local connector setup status. No upstream account calls, keys or personal data.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}};
  return [read,status];
}
async function authenticated(req,env,name){
  const auth=req.headers.get('authorization')||'';
  const expected=env[name];
  if(typeof expected!=='string'||!(/^[0-9a-f]{64}$/.test(expected))||!auth.startsWith('Bearer ')||auth.length>500)return false;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth.slice(7)));
  const computed=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^computed.charCodeAt(i);
  return diff===0;
}
export async function readAccount(provider,args,env,{fetchImpl=fetch}={}){
  const target=TARGETS[provider];
  if(!target)return content({ok:false,code:'UNSUPPORTED_PROVIDER'},true);
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['section','offset','limit'].includes(k)))return content({ok:false,code:'INVALID_ARGUMENTS'},true);
  const section=args.section??'summary',offset=args.offset??0,limit=args.limit??50;
  if(!target.sections.includes(section)||!Number.isInteger(offset)||offset<0||offset>1000||!Number.isInteger(limit)||limit<1||limit>100)return content({ok:false,code:'INVALID_ARGUMENTS'},true);
  if(!env.FBIS_ACCOUNT_VIEW_TOKEN)return content({ok:false,code:'ACCOUNT_VIEW_SECRET_NOT_CONFIGURED',setupRequired:true,readOnly:true},true);
  let r;
  try{
    r=await fetchImpl(target.url,{method:'GET',headers:{'x-fbis-account-token':env.FBIS_ACCOUNT_VIEW_TOKEN,'accept':'application/json'},signal:AbortSignal.timeout(18000),cache:'no-store'});
  }catch{return content({ok:false,provider,code:'ACCOUNT_UPSTREAM_UNREACHABLE',readOnly:true},true);}
  if(!r.ok){await r.body?.cancel();return content({ok:false,provider,code:r.status===403?'ACCOUNT_VIEW_SECRET_MISMATCH':'ACCOUNT_UPSTREAM_HTTP_ERROR',httpStatus:r.status,readOnly:true},true);}
  let obj;try{obj=await r.json();}catch{return content({ok:false,provider,code:'ACCOUNT_UPSTREAM_INVALID_JSON',readOnly:true},true);}
  if(!obj||obj.ok!==true||obj.readOnly!==true)return content({ok:false,provider,code:typeof obj?.code==='string'&&/^[A-Z_]{4,64}$/.test(obj.code)?obj.code:'ACCOUNT_READ_FAILED',readOnly:true},true);
  const base={ok:true,provider:obj.provider||provider,readOnly:true,tradingEnabled:false,capturedAt:obj.capturedAt||null,historyCoverage:obj.historyCoverage||'UNKNOWN',complete:obj.complete||null,accountTotalVerified:obj.accountTotalVerified===true,verifiedReturnsAvailable:obj.verifiedReturnsAvailable===true};
  if(section==='summary')return content({...base,counts:{positions:obj.positions?.length??null,openOrders:obj.openOrders?.length??null,trades:(obj.recentTrades??obj.recentFills)?.length??null},balances:provider==='kalshi'?{availableCashDollars:obj.availableCashDollars??null,positionValueDollars:obj.positionValueDollars??null,accountTotalDollars:obj.accountTotalDollars??null}:undefined,fillReconciliation:provider==='kalshi'?(obj.fillReconciliation??null):undefined});
  if(section==='balances')return content({...base,balances:provider==='polymarket'?(obj.balances??[]):{availableCashDollars:obj.availableCashDollars??null,positionValueDollars:obj.positionValueDollars??null,accountTotalDollars:obj.accountTotalDollars??null}});
  const field=section==='positions'?'positions':section==='orders'?'openOrders':provider==='polymarket'?'recentTrades':'recentFills';
  const values=Array.isArray(obj[field])?obj[field]:[];
  return content({...base,section,offset,limit,returned:values.slice(offset,offset+limit).length,availableInBoundedSnapshot:values.length,nextOffset:offset+limit<values.length?offset+limit:null,rows:values.slice(offset,offset+limit)});
}
export default {async fetch(req,env){
  const path=new URL(req.url).pathname;
  const provider=Object.keys(TARGETS).find(key=>TARGETS[key].path===path);
  if(!provider)return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  if(!await authenticated(req,env,TARGETS[provider].auth))return new Response('Unauthorized',{status:401,headers:{'cache-control':'no-store'}});
  if(req.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST','cache-control':'no-store'}});
  if(Number(req.headers.get('content-length')||0)>8192)return new Response('Request too large',{status:413});
  let message;try{const body=await req.text();if(body.length>8192)return new Response('Request too large',{status:413});message=JSON.parse(body);}catch{return error(null,-32700,'Invalid JSON');}
  if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')return error(null,-32600,'Invalid request');
  if(message.id==null&&message.method.startsWith('notifications/'))return new Response(null,{status:202});
  if(message.id==null)return error(null,-32600,'Request id required');
  if(message.method==='initialize')return result(message.id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:`FBIS ${provider} private account`,version:'1.0.0'}});
  if(message.method==='ping')return result(message.id,{});
  if(message.method==='tools/list')return result(message.id,{tools:toolsFor(provider)});
  if(message.method!=='tools/call')return error(message.id,-32601,'Method not found');
  const n=message.params?.name;const a=message.params?.arguments??{};
  if(n===`fbis_${provider}_account_connection_status`){if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length)return error(message.id,-32602,'Invalid arguments');return result(message.id,content({ok:true,provider,readOnly:true,serverAuthenticated:true,viewSecretConfigured:!!env.FBIS_ACCOUNT_VIEW_TOKEN,upstreamAccountVerified:false,manualRefreshOnly:true,scheduleEnabled:false,storageWrites:false,wagerAuthority:false}));}
  if(n!==TARGETS[provider].name)return error(message.id,-32602,'Unknown tool');
  return result(message.id,await readAccount(provider,a,env));
}};
