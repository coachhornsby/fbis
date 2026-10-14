import {evaluateMarketHeartbeat} from "./lib/marketHeartbeatAudit.mjs";
const BASE = "https://fbis-myz.pages.dev";
const STREAM = "https://fbis-polymarket-us-stream.coachhornsby.workers.dev/health";
async function getJson(url) {
  const response = await fetch(url,{headers:{"cache-control":"no-cache"},signal:AbortSignal.timeout(18000)});
  if (!response.ok) throw Error("HTTP_" + response.status);
  const data = await response.json();
  if (!data || typeof data !== "object") throw Error("INVALID_JSON");
  return data;
}
const services = [
  ["pinnodds",BASE + "/api/pinnodds-status"],
  ["polymarket",BASE + "/api/polymarket-status"],
  ["stream",STREAM]
];
const resolved = await Promise.all(services.map(async ([name,url]) => {
  try {return [name,await getJson(url)]}
  catch(error){return [name,{ok:false,reason:String(error?.message||"UNKNOWN").slice(0,120)}]}
}));
const state = Object.fromEntries(resolved);
const report = evaluateMarketHeartbeat(state);
console.log(JSON.stringify(report,null,2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const {appendFile} = await import("node:fs/promises");
  const lines = [
    "## Primary market-data heartbeat",
    "Read-only checks of FBIS production endpoints. No provider API requests.",
    "",
    "| Source | Observed state |",
    "| --- | --- |",
    `| PinnOdds | ${report.pinnodds.freshFullBoardScopes}/12 full-board scopes captured within 8h |`,
    `| Polymarket REST | Last collection ${report.polymarket.restCaptureAgeMinutes ?? "unknown"} minutes ago |`,
    `| Polymarket WebSocket | ${report.websocket.operational ? "Connected and operational" : report.websocket.idleNoActiveMarkets ? "Idle: no active markets" : "Disconnected or inactive"} |`,
    "",
    `Failures: ${report.failures.join(", ") || "none"}`,
    "",
    `Warnings: ${report.warnings.join(", ") || "none"}`,
    ""
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}
if (!report.ok) process.exitCode=1;
