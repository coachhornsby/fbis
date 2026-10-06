import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseKboHistoricalScoreboard,parseNpbHistoricalMonth,temporalObservation,monthBounds,canonicalGameId } from "../functions/lib/asianBaseballHistory.js";

test("KBO historical scoreboard parser maps canonical teams and finals",()=>{
  const html="<div>KIWOOM 4 FINAL 2 DOOSAN</div><div>JAMSIL 18:30 W: X</div><div>HANWHA 6 FINAL 2 KIA</div><div>GWANGJU 18:30</div>";
  const g=parseKboHistoricalScoreboard(html,"2025-09-17");
  assert.equal(g.length,2);
  assert.equal(g[0].awayTeamId,"kbo-kiw");
  assert.equal(g[0].homeTeamId,"kbo-doo");
  assert.equal(g[0].awayFinalRuns,4);
  assert.equal(g[0].homeFinalRuns,2);
  assert.equal(g[0].venue,"JAMSIL");
  assert.match(g[0].canonicalGameId,/^KBO-20250917-/);
});

test("NPB historical month reuses official schedule parser without inventing source ids",()=>{
  const html=`<table><tr><td>9/2（火）</td><td>巨人 4 - 1 ヤクルト</td><td>京セラD大阪 18:00</td></tr>
    <tr><td></td><td>中日 3 - 5 阪神</td><td>バンテリンドーム 18:00</td></tr></table>`;
  const g=parseNpbHistoricalMonth(html,2025,9);
  assert.equal(g.length,2);
  assert.equal(g[0].homeTeamId,"npb-yg");
  assert.equal(g[0].awayTeamId,"npb-tys");
  assert.equal(g[0].sourceGameId,null);
  assert.equal(g[0].status,"FINAL");
});

test("historical final observations are leakage-safe and never pregame eligible",()=>{
  const g={canonicalGameId:"KBO-X",league:"KBO",scheduledStart:"2025-09-17T09:30:00Z",sourceContract:"X",sourceRef:"Y"};
  const o=temporalObservation(g,{observedAt:"2026-10-06T12:00:00Z"});
  assert.equal(o.relationToStart,"AT_OR_AFTER_START");
  assert.equal(o.pregameEligible,0);
});

test("month shards are bounded and deterministic",()=>{
  assert.deepEqual(monthBounds(2025,9),{start:"2025-09-01",end:"2025-09-30",days:30});
  const id=canonicalGameId({league:"NPB",gameDate:"2025-09-02",awayTeamId:"npb-tys",homeTeamId:"npb-yg"});
  assert.equal(id,"NPB-20250902-npb-tys-npb-yg");
});

test("Phase 2 migration is additive and fail-closed",async()=>{
  const sql=await readFile(new URL("../migrations/0078_asian_baseball_history_foundation.sql",import.meta.url),"utf8");
  assert.match(sql,/asian_baseball_games/);
  assert.match(sql,/asian_baseball_game_observations/);
  assert.match(sql,/asian_baseball_backfill_shards/);
  assert.match(sql,/pregame_eligible INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql,/can_qualify INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql,/can_authorize INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql,/0078_asian_baseball_history_foundation/);
  assert.doesNotMatch(sql,/\bDROP\b|\bDELETE FROM\b/i);
});
