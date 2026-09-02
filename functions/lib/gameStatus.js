/**
 * Operator-facing game status. ESPN/MLB codes map onto a fixed board vocabulary.
 */

export const BOARD_STATUSES = [
  "scheduled",
  "pregame",
  "live",
  "halftime",
  "final",
  "postponed",
  "suspended",
  "canceled",
];

export function classifyBoardStatus(game, now = Date.now()) {
  const detail = String(game?.status?.detail || game?.status?.state || "").toLowerCase();
  if (/postpone/.test(detail) || game?.status?.postponed) return "postponed";
  if (/cancel/.test(detail) || game?.status?.canceled) return "canceled";
  if (/suspend/.test(detail) || game?.status?.suspended) return "suspended";
  if (game?.status?.completed || game?.status?.state === "post" || /^final/.test(detail)) return "final";
  if (/halftime|end of 2nd|mid ?\d/.test(detail) && (game?.status?.live || game?.status?.state === "in")) {
    return "halftime";
  }
  if (game?.status?.live || game?.status?.state === "in") return "live";
  const start = Date.parse(game?.start || "");
  if (Number.isFinite(start) && start - now <= 30 * 60 * 1000 && start > now) return "pregame";
  return "scheduled";
}

export function isPreStartStatus(status) {
  return status === "scheduled" || status === "pregame";
}

export function isLiveStatus(status) {
  return status === "live" || status === "halftime";
}

export function kickoffCt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function noPlayReason(game) {
  if (game?.rec?.qualified) return null;
  const flags = game?.quality?.flags || [];
  if (game?.cfb && game.cfb.bettingAllowed === false) {
    return game.cfb.blockReason || "Projection unavailable for betting — team-specific inputs missing.";
  }
  if (game?.projectionKind === "PINNACLE_IMPLIED" && game?.sport === "nfl") {
    return "FBIS projection unavailable";
  }
  if (game?.marketUnresolved) return "TEAM MATCH UNRESOLVED";
  if (game?.lean) {
    if (game.lean.pauseReason) return game.lean.pauseReason;
    if (game.lean.reason) return game.lean.reason;
    if (game.lean.ev == null) return "No complete Pinnacle pair / no EV";
    if (Number(game.lean.ev) < 0.03) return `EV below +3% gate`;
    return "Candidate did not clear every qualification gate";
  }
  if (game?.model?.projHome == null && game?.model?.projAway == null) return "projection unavailable";
  if (game?.odds?.pinPresent === false || flags.includes("incomplete_pin_ml")) return "market unavailable";
  if (flags.includes("missing_pal") && game?.sport === "mlb") return "context only — Pal unmatched, no qualifying market";
  return "No qualifying ticket";
}
