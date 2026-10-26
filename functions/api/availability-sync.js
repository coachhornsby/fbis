import { productSportDbHandle } from "../lib/databaseTopology.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { syncTwoDeepAvailability } from "../lib/twoDeep.js";
import { syncNflOfficialInjuries } from "../lib/nflOfficialInjuries.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  const shared={
    DB:context.env.DB,
    caches:typeof caches==="undefined"?null:caches.default,
  };
  // The authoritative NFL player profiles moved to NFL_DB. Shared ingestion
  // observations remain in PRIMARY, but the profile materialization must
  // follow the verified deployed sport cutover. No silent PRIMARY fallback.
  const nflOwner=productSportDbHandle(context.env,"nfl");
  if(!nflOwner.db?.prepare)return json({
    ok:false,status:"FAILED",error:"NFL_PROFILE_DB_UNAVAILABLE",reason:nflOwner.reason||"cutover-not-authorized"
  },503);
  const [nflOfficial,twoDeep]=await Promise.all([
    syncNflOfficialInjuries({...shared,NFL_PROFILE_DB:nflOwner.db}),
    syncTwoDeepAvailability({
      ...shared,
      TWODEEP_API_URL:context.env.TWODEEP_API_URL,
      TWODEEP_API_TOKEN:context.env.TWODEEP_API_TOKEN,
      TWODEEP_API_AUTH_HEADER:context.env.TWODEEP_API_AUTH_HEADER,
      TWODEEP_API_AUTH_PREFIX:context.env.TWODEEP_API_AUTH_PREFIX,
    }),
  ]);

  // Official NFL availability is now a first-class source. Two Deep remains an
  // optional augmentation for depth/role context and for CFB.
  const officialOk=nflOfficial.ok===true;
  const twoDeepUsable=twoDeep.ok===true;
  const ok=officialOk; // Two Deep must never mask failure to apply official NFL status to the active NFL_DB.
  const configured=officialOk || twoDeep.configured===true;
  const payload={
    ok,
    status:ok?"SUCCESS":"FAILED",
    configured,
    source:"nfl-official"+(twoDeep.configured?"+twodeep":""),
    fetched:Number(nflOfficial.fetched||0)+Number(twoDeep.fetched||0),
    normalized:Number(nflOfficial.normalized||0)+Number(twoDeep.normalized||0),
    inserted:Number(nflOfficial.inserted||0)+Number(twoDeep.inserted||0),
    already:Number(nflOfficial.already||0)+Number(twoDeep.already||0),
    failed:Number(nflOfficial.failed||0)+Number(twoDeep.failed||0),
    nflOfficial,
    twoDeep,
    reason:ok?null:[nflOfficial.reason,twoDeep.reason].filter(Boolean).join("; ")||"availability-sync-failed",
  };
  return json(payload,ok?200:502);
}
