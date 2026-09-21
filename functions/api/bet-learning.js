import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { queryExecutedBets } from "../lib/store.js";

const terminal = new Set(["WON","LOST","PUSH","VOID"]);

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  const q = await queryExecutedBets({ DB: context.env.DB }, { includeRaw: false });
  if (!q.ok) return json({ ok:false, error:q.reason || "d1-read-failed" }, 503);
  const rows = q.rows || [];
  const eligible = rows.filter((b) => String(b.trackerMetadata?.calibrationEligibility || "").startsWith("ELIGIBLE"));
  const settledEligible = eligible.filter((b) => terminal.has(String(b.result || "").toUpperCase()));
  const bySport = {};
  for (const b of rows) {
    const sport = String(b.sport || "unknown").toLowerCase();
    const bucket = bySport[sport] ||= { tracked:0, settled:0, eligible:0, eligibleSettled:0, wins:0, losses:0, clvN:0, clvSum:0, models:{} };
    bucket.tracked++;
    if (terminal.has(String(b.result || "").toUpperCase())) bucket.settled++;
    const isEligible = String(b.trackerMetadata?.calibrationEligibility || "").startsWith("ELIGIBLE");
    if (isEligible) bucket.eligible++;
    if (isEligible && terminal.has(String(b.result || "").toUpperCase())) {
      bucket.eligibleSettled++;
      if (b.result === "WON") bucket.wins++;
      if (b.result === "LOST") bucket.losses++;
      if (Number.isFinite(Number(b.clv))) { bucket.clvN++; bucket.clvSum += Number(b.clv); }
      const model = b.modelVersionAtEntry || "UNVERSIONED";
      bucket.models[model] = (bucket.models[model] || 0) + 1;
    }
  }
  for (const bucket of Object.values(bySport)) {
    bucket.hitRate = bucket.wins + bucket.losses ? bucket.wins / (bucket.wins + bucket.losses) : null;
    bucket.avgClv = bucket.clvN ? bucket.clvSum / bucket.clvN : null;
    delete bucket.clvSum;
  }
  return json({
    ok:true,
    generatedAt:new Date().toISOString(),
    population:{
      tracked:rows.length,
      eligible:eligible.length,
      eligibleSettled:settledEligible.length,
      rule:"Only records explicitly marked ELIGIBLE with immutable pregame model context enter calibration."
    },
    bySport,
    governance:{
      autoTrain:false,
      autoPromote:false,
      autoWagerAuthority:false,
      note:"Executed bets are evaluation evidence. Small-sample wins/losses never directly mutate model weights."
    }
  });
}

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
