import {authorizeHarvest} from "../lib/auth.js";
import {readExchangeTickets,syncExchangeEvents} from "../lib/exchangeBetLedger.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"private, no-store","x-robots-tag":"noindex"}});
async function authorized(request,env){
  if(authorizeHarvest(request,env).ok)return true;
  if(!env?.FBIS_ACCOUNT_VIEW_TOKEN)return false;
  const supplied=request.headers.get("x-fbis-account-token");
  if(!supplied||supplied.length>512)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(supplied)),
    crypto.subtle.digest("SHA-256",enc.encode(env.FBIS_ACCOUNT_VIEW_TOKEN))]);
  return [...new Uint8Array(a)].every((v,i)=>v===new Uint8Array(b)[i]);
}
export async function onRequestGet({request,env}){
  if(!await authorized(request,env))return json({ok:false,code:"ACCOUNT_ACCESS_DENIED"},403);
  try{const body=await readExchangeTickets(env.DB);return json({ok:true,readOnly:true,...body});}
  catch{return json({ok:false,code:"EXCHANGE_LEDGER_UNAVAILABLE"},503)}
}
export async function onRequestPost({request,env}){
  if(!authorizeHarvest(request,env).ok)return json({ok:false,code:"UNAUTHORIZED"},403);
  try{const result=await syncExchangeEvents(env);return json(result,result.ok?200:503)}
  catch{return json({ok:false,code:"EXCHANGE_SYNC_UNAVAILABLE"},503)}
}
