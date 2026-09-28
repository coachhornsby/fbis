import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { syncTwoDeepAvailability } from "../lib/twoDeep.js";

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
  const payload=await syncTwoDeepAvailability({
    DB:context.env.DB,
    caches:caches.default,
    TWODEEP_API_URL:context.env.TWODEEP_API_URL,
    TWODEEP_API_TOKEN:context.env.TWODEEP_API_TOKEN,
    TWODEEP_API_AUTH_HEADER:context.env.TWODEEP_API_AUTH_HEADER,
    TWODEEP_API_AUTH_PREFIX:context.env.TWODEEP_API_AUTH_PREFIX,
  });
  const status=payload.ok ? 200 : 502;
  return json(payload,status);
}
