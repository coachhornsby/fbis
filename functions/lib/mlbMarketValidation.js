const EDGE_BUCKETS = Object.freeze([
  { key: "0.00-0.49", label: "0.00–0.49", min: 0, max: 0.5 },
  { key: "0.50-0.99", label: "0.50–0.99", min: 0.5, max: 1.0 },
  { key: "1.00-1.49", label: "1.00–1.49", min: 1.0, max: 1.5 },
  { key: "1.50-1.99", label: "1.50–1.99", min: 1.5, max: 2.0 },
  { key: "2.00+", label: "2.00+", min: 2.0, max: Infinity },
]);

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  const xs = (values || []).filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function bucketFor(edge) {
  const x = Math.abs(Number(edge));
  return EDGE_BUCKETS.find((bucket) => x >= bucket.min && x < bucket.max) || EDGE_BUCKETS.at(-1);
}

function summarizeResults(rows) {
  const wins = rows.filter((row) => row.result === "W").length;
  const losses = rows.filter((row) => row.result === "L").length;
  const pushes = rows.filter((row) => row.result === "P").length;
  const decisions = wins + losses;
  return {
    n: rows.length,
    wins,
    losses,
    pushes,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    hitRate: decisions ? rounded(wins / decisions, 4) : null,
  };
}

function groupByEdge(rows) {
  return EDGE_BUCKETS.map((bucket) => {
    const xs = rows.filter((row) => {
      const edge = Math.abs(Number(row.edge));
      return Number.isFinite(edge) && edge >= bucket.min && edge < bucket.max;
    });
    return {
      key: bucket.key,
      label: bucket.label,
      minEdge: bucket.min,
      maxEdge: Number.isFinite(bucket.max) ? bucket.max : null,
      ...summarizeResults(xs),
      avgEdge: rounded(mean(xs.map((row) => Math.abs(row.edge))), 3),
    };
  });
}

function atLeast(rows, threshold) {
  const xs = rows.filter((row) => Math.abs(Number(row.edge)) >= threshold);
  return {
    threshold,
    ...summarizeResults(xs),
    avgEdge: rounded(mean(xs.map((row) => Math.abs(row.edge))), 3),
  };
}

function chooseCanonical(rows) {
  const byGame = new Map();
  for (const row of rows || []) {
    const key = `${row.date || ""}:${row.gameId || row.id || ""}`;
    if (!key.endsWith(":")) {
      const frozenAt = Date.parse(String(row.frozenAt || row.asOf || ""));
      const startAt = Date.parse(String(row.start || ""));
      if (Number.isFinite(frozenAt) && Number.isFinite(startAt) && frozenAt > startAt) continue;
      const prev = byGame.get(key);
      if (!prev) {
        byGame.set(key, row);
        continue;
      }
      const prevAt = Date.parse(String(prev.frozenAt || prev.asOf || ""));
      if (!Number.isFinite(prevAt) || (Number.isFinite(frozenAt) && frozenAt > prevAt)) byGame.set(key, row);
    }
  }
  return [...byGame.values()];
}

function matchupLabel(row) {
  if (row.matchup) return String(row.matchup);
  const away = row.awayAbbr || row.awayName || "AWAY";
  const home = row.homeAbbr || row.homeName || "HOME";
  return `${away} @ ${home}`;
}

export function buildMlbMarketValidation(rows = []) {
  const canonical = chooseCanonical(rows).filter((row) => {
    const sport = String(row.sport || "mlb").toLowerCase();
    return sport === "mlb" && finite(row.actualHome) != null && finite(row.actualAway) != null;
  });

  const sideRows = [];
  const totalRows = [];
  const gameRows = [];
  const marginErrors = [];
  const teamErrors = [];
  const totalErrors = [];
  const marketTotalErrors = [];
  let winnerCorrect = 0;
  let winnerN = 0;

  for (const row of canonical) {
    const projHome = finite(row.projHome);
    const projAway = finite(row.projAway);
    const actualHome = finite(row.actualHome);
    const actualAway = finite(row.actualAway);
    if (projHome == null || projAway == null || actualHome == null || actualAway == null) continue;

    const projMargin = projHome - projAway;
    const actualMargin = actualHome - actualAway;
    const projTotal = projHome + projAway;
    const actualTotal = actualHome + actualAway;
    marginErrors.push(Math.abs(projMargin - actualMargin));
    teamErrors.push(Math.abs(projHome - actualHome), Math.abs(projAway - actualAway));
    totalErrors.push(Math.abs(projTotal - actualTotal));
    if (projMargin !== 0 && actualMargin !== 0) {
      winnerN += 1;
      if ((projMargin > 0) === (actualMargin > 0)) winnerCorrect += 1;
    }

    const pinSpread = finite(row.pinSpread ?? row.spread);
    const pinTotal = finite(row.pinTotal);
    let side = null;
    let total = null;

    if (pinSpread != null) {
      // pinSpread is home-team spread. Convert it to an expected home margin.
      const marketHomeMargin = -pinSpread;
      const edge = projMargin - marketHomeMargin;
      if (Math.abs(edge) > 1e-9) {
        const pickHome = edge > 0;
        const atsMargin = pickHome
          ? actualHome - actualAway + pinSpread
          : actualAway - actualHome - pinSpread;
        const result = Math.abs(atsMargin) < 1e-9 ? "P" : atsMargin > 0 ? "W" : "L";
        side = {
          edge: rounded(edge, 3),
          magnitude: rounded(Math.abs(edge), 3),
          bucket: bucketFor(edge).key,
          selection: pickHome ? (row.homeAbbr || row.homeName || "HOME") : (row.awayAbbr || row.awayName || "AWAY"),
          line: pickHome ? pinSpread : -pinSpread,
          marketHomeMargin: rounded(marketHomeMargin, 3),
          modelHomeMargin: rounded(projMargin, 3),
          actualHomeMargin: rounded(actualMargin, 3),
          result,
        };
        sideRows.push(side);
      }
    }

    if (pinTotal != null) {
      marketTotalErrors.push(Math.abs(pinTotal - actualTotal));
      const edge = projTotal - pinTotal;
      if (Math.abs(edge) > 1e-9) {
        const pickOver = edge > 0;
        const settlement = actualTotal - pinTotal;
        const result = Math.abs(settlement) < 1e-9 ? "P" : (pickOver ? settlement > 0 : settlement < 0) ? "W" : "L";
        total = {
          edge: rounded(edge, 3),
          magnitude: rounded(Math.abs(edge), 3),
          bucket: bucketFor(edge).key,
          selection: pickOver ? "OVER" : "UNDER",
          marketTotal: rounded(pinTotal, 3),
          modelTotal: rounded(projTotal, 3),
          actualTotal: rounded(actualTotal, 3),
          result,
        };
        totalRows.push(total);
      }
    }

    gameRows.push({
      date: row.date || null,
      gameId: String(row.gameId || row.id || ""),
      matchup: matchupLabel(row),
      checkpoint: row.checkpoint || null,
      modelVersion: row.modelVersion || null,
      frozenAt: row.frozenAt || row.asOf || null,
      projected: { away: rounded(projAway, 2), home: rounded(projHome, 2), total: rounded(projTotal, 2), homeMargin: rounded(projMargin, 2) },
      actual: { away: actualAway, home: actualHome, total: actualTotal, homeMargin: actualMargin },
      side,
      total,
    });
  }

  gameRows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.matchup).localeCompare(String(b.matchup)));

  return {
    sport: "mlb",
    generatedAt: new Date().toISOString(),
    population: {
      games: gameRows.length,
      winnerN,
      sideN: sideRows.length,
      totalN: totalRows.length,
      source: "frozen D1 projection snapshots + graded finals",
      note: "ATS and total-direction records are validation cohorts, not profitability claims. Pushes are excluded from hit-rate denominators.",
    },
    projection: {
      winnerCorrect,
      winnerN,
      winnerHitRate: winnerN ? rounded(winnerCorrect / winnerN, 4) : null,
      marginMae: rounded(mean(marginErrors), 3),
      teamScoreMae: rounded(mean(teamErrors), 3),
      totalMae: rounded(mean(totalErrors), 3),
      marketTotalMae: rounded(mean(marketTotalErrors), 3),
      avgProjectedTotal: rounded(mean(gameRows.map((row) => row.projected.total)), 3),
      avgActualTotal: rounded(mean(gameRows.map((row) => row.actual.total)), 3),
      totalBias: rounded(mean(gameRows.map((row) => row.projected.total - row.actual.total)), 3),
    },
    side: {
      ...summarizeResults(sideRows),
      atLeast05: atLeast(sideRows, 0.5),
      atLeast10: atLeast(sideRows, 1.0),
      buckets: groupByEdge(sideRows),
    },
    total: {
      ...summarizeResults(totalRows),
      atLeast05: atLeast(totalRows, 0.5),
      atLeast10: atLeast(totalRows, 1.0),
      buckets: groupByEdge(totalRows),
    },
    games: gameRows,
  };
}

export { EDGE_BUCKETS };
