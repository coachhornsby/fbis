/**
 * Pregame projection checkpoints. First-sight freeze is not enough.
 */

export const CHECKPOINTS = ["FIRST_AVAILABLE", "EARLY", "MORNING", "LINEUP_CONFIRMED", "PREGAME", "CLOSE"];
export const CHECKPOINT_ALIASES = { INFORMATION_CONFIRMED: "LINEUP_CONFIRMED" };
export const CHECKPOINT_OPTIONS = ["FIRST_AVAILABLE", "EARLY", "MORNING", "LINEUP_CONFIRMED", "INFORMATION_CONFIRMED", "PREGAME", "CLOSE", "LATEST"];

const RANK = {
  FIRST_AVAILABLE: 0,
  EARLY: 1,
  MORNING: 2,
  LINEUP_CONFIRMED: 3,
  PREGAME: 4,
  CLOSE: 5,
};

export function checkpointRank(name) {
  return RANK[name] || 0;
}

function hourCT(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 12);
}

/** Classify the current moment relative to kickoff / lineup state. */
export function classifyCheckpoint(game, now = Date.now()) {
  const start = new Date(game?.start).getTime();
  if (Number.isFinite(start)) {
    const mins = (start - now) / 60000;
    if (mins <= 45) return "CLOSE";
    if (mins <= 90) return "PREGAME";
  }
  if (game?.bpp?.lineupsOfficial) return "LINEUP_CONFIRMED";
  const hour = hourCT(now);
  if (hour < 12) return "MORNING";
  return "EARLY";
}

export function snapshotKey(date, gameId, checkpoint, modelVersion = null) {
  const base = `${date}:${gameId}:${checkpoint}`;
  return modelVersion ? `${base}:${modelVersion}` : base;
}

export function materiallyChanged(prev, next) {
  if (!prev) return true;
  const keys = ["projHome", "projAway", "pHomeFinal", "pPal", "pScore", "palHome", "palAway"];
  return keys.some((k) => round4(prev[k]) !== round4(next[k]));
}

function round4(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10000) / 10000;
}

export function rowsForCheckpoint(rows, checkpoint) {
  if (!checkpoint || checkpoint === "LATEST") return rows || [];
  const want = CHECKPOINT_ALIASES[checkpoint] || checkpoint;
  if (want !== "FIRST_AVAILABLE") {
    return (rows || []).filter((r) => r.checkpoint === want || (checkpoint === "INFORMATION_CONFIRMED" && r.checkpoint === "LINEUP_CONFIRMED"));
  }
  const explicit = (rows || []).filter((r) => r.checkpoint === "FIRST_AVAILABLE");
  if (explicit.length) return explicit;
  const byGame = new Map();
  for (const row of rows || []) {
    const k = `${row.date}:${row.id}`;
    const prev = byGame.get(k);
    if (!prev || checkpointRank(row.checkpoint) < checkpointRank(prev.checkpoint)) {
      byGame.set(k, row);
    }
  }
  return [...byGame.values()];
}

export function pickCanonical(rows) {
  const byGame = new Map();
  for (const row of rows || []) {
    const k = `${row.date}:${row.id}`;
    const prev = byGame.get(k);
    if (!prev) {
      byGame.set(k, row);
      continue;
    }
    const pr = checkpointRank(prev.checkpoint);
    const nr = checkpointRank(row.checkpoint);
    if (nr > pr) byGame.set(k, row);
    else if (nr === pr && String(row.frozenAt || "") > String(prev.frozenAt || "")) byGame.set(k, row);
  }
  return [...byGame.values()];
}
