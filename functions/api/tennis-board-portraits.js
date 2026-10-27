// Bounded read-only bridge to the existing exact-identity, rights-gated registry.
import {approvedTennisPortraits} from '../lib/tennisPortraits.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'public,max-age=60'}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),tour=u.searchParams.get('tour');let names;
 try{names=JSON.parse(u.searchParams.get('names')||'null');}catch{}
 if(!['atp','wta'].includes(tour)||!Array.isArray(names)||names.length>40||!names.length||names.some(n=>typeof n!=='string'||!n.trim()||n.length>120))return json({ok:false,reason:'BOUNDED_TOUR_NAMES_REQUIRED'},400);
 if(!env.DB?.prepare)return json({ok:false,reason:'CANONICAL_STORE_UNAVAILABLE'},503);
 try{
  const keys=[...new Set(names.map(n=>n.toLowerCase().trim()))];
  const normalized=[...new Set(keys.map(n=>n.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()))];
  const rows=(await env.DB.prepare(`SELECT fbis_player_id,canonical_name FROM tennis_players WHERE tour=? AND normalized_name IN (${normalized.map(()=>'?').join(',')}) AND lower(canonical_name) IN (${keys.map(()=>'?').join(',')})`).bind(tour,...normalized,...keys).all()).results||[];
  const byName=new Map();for(const r of rows){const k=r.canonical_name.toLowerCase().trim();byName.set(k,[...(byName.get(k)||[]),r]);}
  const unique=[...byName.values()].filter(r=>r.length===1).map(r=>r[0]);const portraits=new Map();
  for(let i=0;i<unique.length;i+=20)for(const [key,value] of await approvedTennisPortraits(env.DB,unique.slice(i,i+20).map(r=>r.fbis_player_id)))portraits.set(key,value);
  return json({ok:true,tour,players:unique.filter(r=>portraits.has(r.fbis_player_id)).map(r=>({name:r.canonical_name,canonicalId:r.fbis_player_id,portrait:portraits.get(r.fbis_player_id)})),newSourcesAdmitted:false});
 }catch{return json({ok:false,reason:'APPROVED_PORTRAITS_UNAVAILABLE'},503);}
}
