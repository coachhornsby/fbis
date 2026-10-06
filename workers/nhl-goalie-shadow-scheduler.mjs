import { freezeRows, persist, settle } from "../functions/api/nhl-goalie-shadow.js";

const BASE="https://fbis-myz.pages.dev";
const TZ="America/Chicago";

function dateCt(d=new Date()){
  return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
}

async function fetchJson(url){
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-SHADOW-CRON/1.0"},signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw new Error(`HTTP_${r.status} ${url}`);
  return r.json();
}

async function runCycle(env){
  if(!env?.DB?.prepare)throw new Error("D1_UNAVAILABLE");
  const now=new Date();
  const date=dateCt(now);
  const [board,status]=await Promise.all([
    fetchJson(`${BASE}/api/today?date=${encodeURIComponent(date)}&sport=nhl`),
    fetchJson(`${BASE}/api/nhl-goalie-shadow`)
  ]);
  const snapshotAt=new Date().toISOString();
  const rows=await freezeRows(env.DB,board,snapshotAt,status?.codeSha||null);
  const freeze=await persist(env.DB,rows);
  const grading=await settle(env.DB,date);
  const summary=status?.productionChampion==="NHL-PRO-v2"
    ? await (async()=>{ const r=await fetchJson(`${BASE}/api/nhl-goalie-shadow`); return r; })()
    : null;
  console.log(JSON.stringify({
    ok:true,
    scheduler:"CLOUDFLARE_CRON",
    scheduledAt:snapshotAt,
    date,
    candidates:rows.length,
    gateFired:rows.filter(r=>r.gateFired).length,
    temporalIntegrityPassed:rows.filter(r=>r.temporalIntegrityPassed).length,
    freeze,
    grading,
    productionChampion:summary?.productionChampion||status?.productionChampion||null,
    productionChanged:summary?.productionChanged??status?.productionChanged??null,
    qualificationChanged:summary?.qualificationChanged??status?.qualificationChanged??null,
    authority:summary?.authority??status?.authority??null,
    staking:summary?.staking??status?.staking??null,
  }));
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil(runCycle(env));
  },
  async fetch(){
    return new Response(JSON.stringify({ok:true,scheduler:"fbis-nhl-goalie-shadow-scheduler"}),{
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }
};
