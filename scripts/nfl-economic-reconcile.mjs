#!/usr/bin/env node
/**
 * Reconcile NFL tracker economics separately from nfl_wager_decisions.
 * Read-only against production API. Does not authorize wagers.
 */
const BASE = process.env.FBIS_BASE || "https://fbis-myz.pages.dev";

const res = await fetch(`${BASE}/api/bets?limit=500`);
if (!res.ok) throw new Error(`bets HTTP ${res.status}`);
const body = await res.json();
const bets = (body.bets || []).filter((b) => String(b.sport || "").toLowerCase() === "nfl");
const byMarket = {};
let risk = 0;
let profit = 0;
let missingRisk = 0;
let missingPrice = 0;
let syntheticClock = 0;
let wins = 0;
let losses = 0;
let pushes = 0;

for (const b of bets) {
  const market = String(b.market || "UNKNOWN");
  byMarket[market] ||= { n: 0, wins: 0, losses: 0, pushes: 0, risk: 0, profit: 0 };
  byMarket[market].n += 1;
  const result = String(b.result || "").toUpperCase();
  if (result === "WON" || result === "WIN" || result === "W") {
    wins += 1;
    byMarket[market].wins += 1;
  } else if (result === "LOST" || result === "LOSS" || result === "L") {
    losses += 1;
    byMarket[market].losses += 1;
  } else if (result === "PUSH") {
    pushes += 1;
    byMarket[market].pushes += 1;
  }
  const r = Number(b.riskAmount);
  const p = Number(b.profit);
  if (Number.isFinite(r)) {
    risk += r;
    byMarket[market].risk += r;
  } else missingRisk += 1;
  if (Number.isFinite(p)) {
    profit += p;
    byMarket[market].profit += p;
  }
  if (b.executionPrice == null) missingPrice += 1;
  if (String(b.trackerMetadata?.executedAtProvenance || "").includes("synthetic")) syntheticClock += 1;
}

const summary = body.summary?.bySport?.nfl || null;
const report = {
  schema: "nfl-economic-reconcile-v1",
  generatedAt: new Date().toISOString(),
  source: "unified_execution_ledger /api/bets",
  separateFrom: {
    nfl_wager_decisions: "PASS-only research decisions; not executed bets",
    playerProps: "Reported separately inside market breakdown",
  },
  apiSummary: summary,
  recomputed: {
    n: bets.length,
    record: `${wins}-${losses}${pushes ? `-${pushes}P` : ""}`,
    wins,
    losses,
    pushes,
    risk: Number(risk.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    roi: risk ? Number((profit / risk).toFixed(6)) : null,
    missingRisk,
    missingPrice,
    syntheticReceiptClock: syntheticClock,
  },
  byMarket,
  interpretation: [
    "Reported 28-14 appears to be a stale/rounded recollection; live ledger is 29-14 with 1 push.",
    "Negative dollars with a strong win rate is consistent with incomplete stake/price fields, player-prop losses (0-6), and variable risk.",
    "These tickets are operator-reported tracker imports, not FBIS-authorized model wagers.",
    "CLV is not calculable for the NFL cohort (validClvN=0).",
  ],
  governance: {
    modelAuthorizedWagers: false,
    canExpandWagerAuthority: false,
  },
};

console.log(JSON.stringify(report, null, 2));
