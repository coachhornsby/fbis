#!/usr/bin/env node
/** Immutable run-scoped research observation; never creates a bet or retroactively replays input. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = (process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const date = "2026-10-11";
const target = [["DEN","LAC"],["DET","ARI"],["SF","SEA"]];
const abbr = t => String(typeof t==="string"?t:(t?.abbr||t?.abbreviation||"")).toUpperCase();
const relevant = g => target.some(([a,h])=>a===abbr(g.away)&&h===abbr(g.home));
const stamp = new Date().toISOString();
if (stamp.slice(0,10)!==date) {
 console.log(JSON.stringify({ok:true,skipped:"date-scoped-2026-10-11-only",stamp}));
 process.exit(0);
}
const url = `${base}/api/today?sport=nfl&date=${date}&_pit=${Date.now()}`;
const response = await fetch(url,{headers:{accept:"application/json","cache-control":"no-cache"}});
if (!response.ok) throw new Error(`board-http-${response.status}`);
const body = await response.json();
const games = (body.games||body.slate?.games||[]).filter(relevant);
if (games.length !== 3) throw new Error(`pregame-coverage-incomplete-${games.length}-of-3`);
const records=games.map(g=>{
 const start=Date.parse(g.start||g.startTime||"");
 const validStart=Number.isFinite(start);
 const pregame=validStart&&Date.now()<start&&!(g.status?.live||g.status?.completed||g.gameState?.live||g.gameState?.completed);
 return {
  gameId:String(g.id),away:abbr(g.away),home:abbr(g.home),start:g.start||g.startTime||null,
  capturedAt:stamp,classification:pregame?"PROSPECTIVE_PREGAME":"NOT_PREGAME",
  modelVersion:g.modelVersion||g.researchProjection?.modelVersion||null,
  projectedHome:g.model?.projHome??g.researchProjection?.home??g.projHomeScore??null,
  projectedAway:g.model?.projAway??g.researchProjection?.away??g.projAwayScore??null,
  marketObservedAt:g.odds?.observedAt||g.odds?.asOf||null,
  marketSourceTimestamp:g.odds?.sourceTimestamp||null,
  bookmaker:g.odds?.book||g.pin?.book||null,
  homeSpread:g.odds?.pinSpread??g.odds?.spread??null,
  totalLine:g.odds?.pinTotal??g.odds?.total??null,
  homeMoneyline:g.odds?.pinHomeMl??null,awayMoneyline:g.odds?.pinAwayMl??null,
  homeSpreadPrice:g.odds?.pinSpreadHomePrice??null,
  totalOverPrice:g.odds?.pinOverPrice??null,
  researchOnly:true,canQualify:false,canAuthorizeWager:false,
  rawGame:g
 };
});
const packet={schema:"fbis-nfl-prospective-capture-v1",capturedAt:stamp,source:url,
 researchOnly:true,prospectiveGames:records.filter(g=>g.classification==="PROSPECTIVE_PREGAME").length,
 sourceWarning:"Board observation, not guaranteed immutable source feature provenance; entry/close prices require later verification.",
 games:records};
const json=JSON.stringify(packet);
const digest=createHash("sha256").update(json).digest("hex");
const dir="artifacts/nfl-pregame-oct11";
await mkdir(dir,{recursive:true});
await writeFile(`${dir}/capture.json`,json);
await writeFile(`${dir}/sha256.txt`,digest+"  capture.json\n");
console.log(JSON.stringify({ok:true,stamp,digest,games:records.map(({away,home,classification,projectedHome,projectedAway,marketObservedAt})=>({away,home,classification,projectedHome,projectedAway,marketObservedAt}))}));
if(!packet.prospectiveGames) process.exitCode=2;
