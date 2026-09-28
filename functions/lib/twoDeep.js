/**
 * Licensed Two Deep availability sync.
 *
 * No provider endpoint is hard-coded. Once the license is finalized, install
 * the exact endpoint URL and auth token from Two Deep as secrets:
 *   TWODEEP_API_URL
 *   TWODEEP_API_TOKEN
 * Optional:
 *   TWODEEP_API_AUTH_HEADER (default: authorization)
 *   TWODEEP_API_AUTH_PREFIX (default: Bearer )
 *
 * This keeps us within the licensed contract and avoids scraping the public site.
 */

import { normalizeAvailabilityRecord } from "./availability.js";
import { persistAvailabilityObservations, setMeta } from "./store.js";

function clean(v){ return String(v||"").trim(); }

function inheritedContext(node={}, parent={}){
  return {
    sport:
      clean(node.sport ?? node.league ?? node.competition ?? parent.sport).toLowerCase() ||
      parent.sport ||
      "",
    teamKey:
      clean(
        node.teamKey ?? node.team_key ?? node.teamAbbr ?? node.team_abbr ??
        node.teamId ?? node.team_id ?? parent.teamKey
      ).toLowerCase() || parent.teamKey || "",
    teamName:
      clean(node.teamName ?? node.team_name ?? node.team?.name ?? parent.teamName) ||
      parent.teamName ||
      "",
  };
}

function looksLikeAvailabilityRecord(node={}){
  if(!node || typeof node!=="object" || Array.isArray(node)) return false;
  const player=clean(node.playerName ?? node.player_name ?? node.athleteName ?? node.athlete_name ?? node.name);
  const status=clean(node.status ?? node.availability ?? node.designation ?? node.injuryStatus ?? node.injury_status);
  return Boolean(player && status);
}

function flattenNode(node, parent={}, out=[], depth=0){
  if(depth>8 || node==null) return out;
  if(Array.isArray(node)){
    for(const item of node) flattenNode(item,parent,out,depth+1);
    return out;
  }
  if(typeof node!=="object") return out;
  const ctx=inheritedContext(node,parent);
  if(looksLikeAvailabilityRecord(node)){
    out.push({...node,...ctx});
  }
  const keys=["records","items","data","results","players","athletes","availability","injuries","updates","teams"];
  for(const key of keys){
    if(node[key]!=null) flattenNode(node[key],ctx,out,depth+1);
  }
  return out;
}

export function extractTwoDeepAvailability(payload){
  return flattenNode(payload,{},[]);
}

export async function syncTwoDeepAvailability(env={}){
  const url=clean(env.TWODEEP_API_URL);
  const token=clean(env.TWODEEP_API_TOKEN);
  if(!url || !token){
    return {
      ok:true,
      status:"CONFIGURATION_PENDING",
      configured:false,
      fetched:0,
      normalized:0,
      inserted:0,
      already:0,
      failed:0,
      reason:!url && !token ? "TWODEEP_API_URL and TWODEEP_API_TOKEN missing" : !url ? "TWODEEP_API_URL missing" : "TWODEEP_API_TOKEN missing",
    };
  }

  const headerName=clean(env.TWODEEP_API_AUTH_HEADER)||"authorization";
  const prefix=env.TWODEEP_API_AUTH_PREFIX==null ? "Bearer " : String(env.TWODEEP_API_AUTH_PREFIX);
  const startedAt=new Date().toISOString();
  await setMeta(env,"last_twodeep_attempt_at",startedAt).catch(()=>{});

  try{
    const res=await fetch(url,{
      method:"GET",
      headers:{
        accept:"application/json",
        [headerName]:prefix+token,
        "user-agent":"FBIS-Personal-Projection-System/1.0",
      },
    });
    const text=await res.text();
    await setMeta(env,"last_twodeep_http_status",String(res.status)).catch(()=>{});
    if(!res.ok){
      const reason=`Two Deep HTTP ${res.status}`;
      await setMeta(env,"last_twodeep_error",reason).catch(()=>{});
      return {ok:false,status:"FAILED",configured:true,httpStatus:res.status,reason};
    }

    let payload;
    try{ payload=JSON.parse(text); }
    catch{
      const reason="Two Deep response was not JSON";
      await setMeta(env,"last_twodeep_error",reason).catch(()=>{});
      return {ok:false,status:"FAILED",configured:true,httpStatus:res.status,reason};
    }

    const raw=extractTwoDeepAvailability(payload);
    const observedAt=new Date().toISOString();
    const rows=raw
      .map((row)=>normalizeAvailabilityRecord(row,{source:"twodeep",observedAt}))
      .filter(Boolean);
    const persisted=rows.length
      ? await persistAvailabilityObservations(env,rows)
      : {ok:true,inserted:0,already:0,failed:0};

    if(persisted.ok){
      await setMeta(env,"last_twodeep_success_at",observedAt).catch(()=>{});
      await setMeta(env,"last_twodeep_records_returned",String(raw.length)).catch(()=>{});
      await setMeta(env,"last_twodeep_records_normalized",String(rows.length)).catch(()=>{});
      await setMeta(env,"last_twodeep_error","").catch(()=>{});
    }else{
      await setMeta(env,"last_twodeep_error",persisted.reason||"persist-failed").catch(()=>{});
    }

    return {
      ok:persisted.ok,
      status:persisted.ok?"SUCCESS":"FAILED",
      configured:true,
      httpStatus:res.status,
      fetched:raw.length,
      normalized:rows.length,
      inserted:persisted.inserted||0,
      already:persisted.already||0,
      failed:persisted.failed||0,
      reason:persisted.reason||null,
      observedAt,
    };
  }catch(err){
    const reason=String(err?.message||err);
    await setMeta(env,"last_twodeep_error",reason).catch(()=>{});
    return {ok:false,status:"FAILED",configured:true,fetched:0,normalized:0,inserted:0,already:0,failed:0,reason};
  }
}
