const MATCHUP_SYMBOL_BY_ID = {
  pressure: "PR", run: "RN", coverageRoute: "CV", explosive: "XP", earlyDown: "ED",
  starter: "SP", starters: "SP", bullpen: "BP", offense: "OF", "run-prevention": "RP",
  lineup: "LU", form: "FM", environment: "ENV", "matchup-eff": "EFF", defense: "DF",
  pace: "PC", projection: "PROJ", "five-v-five": "5V5", finishing: "FIN", goaltending: "G",
  "special-teams": "ST", "high-danger": "HD", rest: "RST", attack: "ATK",
  "expected-goals": "xG", btts: "BTTS", surface: "SUR", serve: "SRV", return: "RET", fitness: "FIT",
  efficiency: "EFF", efg: "eFG", turnovers: "TO", rebounding: "REB", "free-throws": "FT",
  "pitch-hit-edge": "PvH", "pitch-vs-hit-home": "PvH", "pitch-vs-hit-away": "PvH",
};

const MATCHUP_SHORT_LABEL_BY_ID = {
  pressure: "PRESSURE", run: "RUN GAME", coverageRoute: "COVERAGE", explosive: "EXPLOSIVE", earlyDown: "EARLY DOWN",
  starter: "STARTER", starters: "STARTERS", bullpen: "BULLPEN", offense: "OFFENSE", "run-prevention": "RUN PREVENTION",
  lineup: "LINEUP", form: "RECENT FORM", environment: "ENVIRONMENT", "matchup-eff": "EFFICIENCY", defense: "DEFENSE",
  pace: "PACE", projection: "PROJECTION", "five-v-five": "5V5 xG", finishing: "FINISHING", goaltending: "GOALTENDING",
  "special-teams": "SPECIAL TEAMS", "high-danger": "HIGH DANGER", rest: "REST", attack: "ATTACK",
  "expected-goals": "EXPECTED GOALS", btts: "BTTS", surface: "SURFACE", serve: "SERVE", return: "RETURN", fitness: "FITNESS",
  efficiency: "EFFICIENCY", efg: "eFG%", turnovers: "TURNOVERS", rebounding: "O-REBOUND", "free-throws": "FT RATE",
  "pitch-hit-edge": "PITCH VS HIT EDGE", "pitch-vs-hit-home": "PITCH VS HIT", "pitch-vs-hit-away": "PITCH VS HIT",
};

function stripDecorativeEmoji(rawLabel) {
  return String(rawLabel || "MATCHUP")
    .replace(/^(?:\p{Extended_Pictographic}|[↩︎↩️])(?:\uFE0F)?\s*/u, "")
    .trim();
}

function matchupVisualKey(id) {
  const key = String(id || "");
  if (MATCHUP_SYMBOL_BY_ID[key] || MATCHUP_SHORT_LABEL_BY_ID[key]) return key;
  if (/^lineup-/.test(key)) return "lineup";
  if (/^starter-/.test(key)) return "starter";
  if (/^batter-/.test(key)) return "batter";
  if (/^pitch-vs-hit-/.test(key) || key === "pitch-hit-edge") return key;
  if (/bullpen/.test(key)) return "bullpen";
  if (/environment|park/.test(key)) return "environment";
  return key;
}

export function splitMatchupVisual(id, rawLabel) {
  const key = matchupVisualKey(id);
  const raw = stripDecorativeEmoji(rawLabel).toUpperCase();
  const prefixLabel = key === "batter" ? "BATTER / SP" : null;
  return {
    icon: key === "batter" ? "BvP" : MATCHUP_SYMBOL_BY_ID[key] || "SIG",
    label: MATCHUP_SHORT_LABEL_BY_ID[key] || prefixLabel || raw,
  };
}

