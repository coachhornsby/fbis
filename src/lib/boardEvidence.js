export function evidenceNumber(value) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// Presentation only; consumes existing model comparisons without changing them.
export function fmt(v) {
  const n = evidenceNumber(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(Math.abs(n % 1) > 0.001 ? 1 : 0);
}

export function lineLabel(team, line) {
  const n = evidenceNumber(line);
  if (!team || !Number.isFinite(n)) return "SPREAD";
  if (Math.abs(n) < 0.05) return `${team.abbr || "PICK"} PK`;
  return `${team.abbr || "TEAM"} ${n > 0 ? "+" : ""}${fmt(n)}`;
}

export function bestEdge(vm) {
  const cmp = vm.comparison || {};
  const spreadAbs = evidenceNumber(cmp.sideDiff);
  const spreadSigned = evidenceNumber(cmp.sideSignedDiff);
  const total = evidenceNumber(cmp.totalDiff);
  const totalAbs = Number.isFinite(total) ? Math.abs(total) : -1;
  const spreadMagnitude = Number.isFinite(spreadAbs) ? Math.abs(spreadAbs) : -1;

  if (spreadMagnitude < 0 && totalAbs < 0) {
    return { value: "—", detail: "NO EDGE", type: "EDGE", team: null, total: false };
  }

  if (spreadMagnitude >= totalAbs) {
    const marketHomeSpread = evidenceNumber(vm.market?.spread);
    const away = vm.away || {};
    const home = vm.home || {};
    let team = null;
    let offeredLine = null;

    // signed gap = fair home spread - market home spread.
    // Positive => market is too favorable to the away team.
    // Negative => market is too favorable to the home team.
    if (Number.isFinite(spreadSigned) && Number.isFinite(marketHomeSpread)) {
      if (spreadSigned > 0) {
        team = away;
        offeredLine = -marketHomeSpread;
      } else if (spreadSigned < 0) {
        team = home;
        offeredLine = marketHomeSpread;
      }
    }

    return {
      value: `+${fmt(spreadMagnitude)}`,
      detail: lineLabel(team, offeredLine),
      type: "SPREAD",
      team,
      total: false,
    };
  }

  return {
    value: `${total > 0 ? "+" : ""}${fmt(total)}`,
    detail: total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL",
    type: "TOTAL",
    team: null,
    total: true,
  };
}

export function matchupSignalLabel(signal, away, home) {
  if (!signal?.available) return { text: "—", tone: "neutral" };
  const n = evidenceNumber(signal.adjustment);
  if (!Number.isFinite(n)) return { text: "—", tone: "neutral" };
  if (Math.abs(n) < 0.15) return { text: "EVEN", tone: "neutral" };
  const team = n > 0 ? home : away;
  return { text: team?.abbr || (n > 0 ? "HOME" : "AWAY"), tone: n > 0 ? "home" : "away" };
}
