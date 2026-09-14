/**
 * PrizePicks slip parser — paste / OCR text only.
 * Expands a Power Play (or Flex) entry into one PLAYER_PROP ticket per leg.
 * Does not invent prices: stake + to-win come from the slip; American odds are derived.
 */

import { hashText } from "./heritageSlip.js";
import { identityForSport } from "./teams.js";

const PROP_ALIASES = [
  [/pass(?:ing)?\s*attempts?/i, "PASS_ATTEMPTS"],
  [/pass(?:ing)?\s*yards?/i, "PASS_YARDS"],
  [/pass(?:ing)?\s*tds?|pass(?:ing)?\s*touchdowns?/i, "PASS_TOUCHDOWNS"],
  [/rush(?:ing)?\s*yards?/i, "RUSH_YARDS"],
  [/rush(?:ing)?\s*attempts?/i, "RUSH_ATTEMPTS"],
  [/rush(?:ing)?\s*tds?|rush(?:ing)?\s*touchdowns?/i, "RUSH_TOUCHDOWNS"],
  [/receiv(?:ing)?\s*yards?/i, "RECEIVING_YARDS"],
  [/receptions?|\brecs\b/i, "RECEPTIONS"],
  [/receiv(?:ing)?\s*tds?|receiv(?:ing)?\s*touchdowns?/i, "RECEIVING_TOUCHDOWNS"],
  [/anytime\s*td|anytime\s*touchdown/i, "ANYTIME_TD"],
  [/points/i, "POINTS"],
  [/rebounds?/i, "REBOUNDS"],
  [/assists?/i, "ASSISTS"],
  [/strikeouts?/i, "PITCHER_STRIKEOUTS"],
  [/hits/i, "HITS"],
  [/total\s*bases?/i, "TOTAL_BASES"],
];

const SPORT_ALIASES = {
  NFL: "nfl",
  MLB: "mlb",
  NBA: "nba",
  NHL: "nhl",
  NCAAF: "cfb",
  CFB: "cfb",
  "COLLEGE FOOTBALL": "cfb",
  NCAAB: "cbb",
  CBB: "cbb",
};

function ctDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function americanFromPayout(risk, payout) {
  const profit = Number(payout) - Number(risk);
  if (!(risk > 0) || !(profit > 0)) return null;
  return Math.round(profit >= risk ? (profit / risk) * 100 : -(risk / profit) * 100);
}

function normalizePropType(label) {
  const text = String(label || "").trim();
  for (const [re, type] of PROP_ALIASES) {
    if (re.test(text)) return type;
  }
  return text
    ? text.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "PLAYER_PROP"
    : "PLAYER_PROP";
}

function detectSport(text) {
  const m = String(text).match(/\b(NFL|MLB|NBA|NHL|NCAAF|CFB|NCAAB|CBB|COLLEGE\s+FOOTBALL)\b/i);
  if (!m) return "nfl";
  return SPORT_ALIASES[m[1].toUpperCase().replace(/\s+/g, " ")] || "nfl";
}

function detectMatchup(text, sport) {
  const cleaned = String(text || "");
  const vs =
    cleaned.match(
      /\b([A-Z]{2,4})\s*(?:vs\.?|v\.?|@)\s*([A-Z]{2,4})\b/,
    ) ||
    cleaned.match(
      /\|\s*([A-Z]{2,4})\s*(?:vs\.?|v\.?|@)\s*([A-Z]{2,4})\b/,
    );
  if (!vs) return { awayTeam: null, homeTeam: null, awayIdentity: null, homeIdentity: null, matchupText: null };
  const a = vs[1];
  const b = vs[2];
  // PrizePicks often shows "DEN vs KC" without home/away guarantee — keep order as printed.
  const awayIdentity = identityForSport(sport, a);
  const homeIdentity = identityForSport(sport, b);
  const awayTeam = awayIdentity.canonicalId ? awayIdentity.name : a;
  const homeTeam = homeIdentity.canonicalId ? homeIdentity.name : b;
  return {
    awayTeam,
    homeTeam,
    awayIdentity,
    homeIdentity,
    matchupText: `${awayTeam} vs ${homeTeam}`,
  };
}

function parseStake(text) {
  const cleaned = String(text || "");
  const toWin =
    cleaned.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*to\s*win\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
    cleaned.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*.{0,12}?win\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (toWin) {
    const riskAmount = Number(toWin[1]);
    const potentialPayout = Number(toWin[2]);
    return {
      riskAmount,
      potentialPayout,
      toWinAmount: Math.round((potentialPayout - riskAmount) * 100) / 100,
    };
  }
  const dollars = [...cleaned.matchAll(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g)].map((m) => Number(m[1]));
  if (dollars.length >= 2) {
    const riskAmount = dollars[0];
    const potentialPayout = dollars[1];
    return {
      riskAmount,
      potentialPayout,
      toWinAmount: Math.round((potentialPayout - riskAmount) * 100) / 100,
    };
  }
  return { riskAmount: null, potentialPayout: null, toWinAmount: null };
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseSlipDate(text, dateHint) {
  if (dateHint && /^\d{4}-\d{2}-\d{2}$/.test(String(dateHint))) return String(dateHint);
  const m = String(text || "").match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (!m) return ctDate();
  const month = MONTHS[m[1].toLowerCase()];
  const day = String(Number(m[2])).padStart(2, "0");
  const year = m[3];
  if (!month) return ctDate();
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

function parseEntryType(text) {
  const cleaned = String(text || "");
  const power = cleaned.match(/(\d+)\s*[- ]\s*pick\s+power\s*play/i) || cleaned.match(/power\s*play/i);
  const flex = cleaned.match(/(\d+)\s*[- ]\s*pick\s+flex/i) || cleaned.match(/\bflex\b/i);
  if (power) {
    return {
      entryType: "POWER_PLAY",
      pickCount: power[1] ? Number(power[1]) : null,
      label: power[0].replace(/\s+/g, " ").trim(),
    };
  }
  if (flex) {
    return {
      entryType: "FLEX",
      pickCount: flex[1] ? Number(flex[1]) : null,
      label: flex[0].replace(/\s+/g, " ").trim(),
    };
  }
  const picks = cleaned.match(/(\d+)\s*[- ]\s*pick/i);
  return {
    entryType: "PICK_EM",
    pickCount: picks ? Number(picks[1]) : null,
    label: picks ? picks[0].replace(/\s+/g, " ").trim() : "PrizePicks",
  };
}

function isMetaLine(line) {
  return /prize\s*picks|power\s*play|\bflex\b|starts?\s+in|to\s+win|slide\s+for|self\s+refund|time\s+remaining|^\d+-?\s*pick\b|^\|?\s*(NFL|MLB|NBA|NHL|NCAAF|CFB)\b/i.test(
    line,
  );
}

function isTeamMetaLine(line) {
  // e.g. "KC QB #15" / "DEN • RB • #12" after bullet normalization.
  // Require jersey number so short names like "Bo Nix" are not treated as team meta.
  return /^[A-Z]{2,4}\s+(?:[A-Z]{1,3}\s+)?#?\d+\s*$/i.test(line)
    || /^[A-Z]{2,4}\s+(QB|RB|WR|TE|K|P|LB|DB|CB|S|DE|DT|G|T|C|OT|OG|FB|SF|PF|PG|SG|C|F|D|G|P|C|LW|RW|SP|RP|DH|OF|IF|1B|2B|3B|SS)\s+#?\d+\s*$/i.test(line);
}

function isPlayerNameLine(line) {
  if (!line || isMetaLine(line) || isTeamMetaLine(line)) return false;
  if (/yards|attempts|points|receptions|touchdowns?|strikeouts?|rebounds?|assists?/i.test(line)) return false;
  if (/^\$|\d+\.\d+/.test(line)) return false;
  return (
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z.']+)+$/.test(line) ||
    /^[A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z'-]+$/.test(line) ||
    /^[A-Z]{1,3}\s+[A-Z][a-z'-]+$/.test(line) // RJ Harvey
  );
}

function parseProjectionLine(line) {
  const arrow =
    line.match(/^(↑|↓|More|Less|Over|Under)\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/i) ||
    line.match(/^([0-9]+(?:\.[0-9]+)?)\s+(.+?)\s+(More|Less|Over|Under)$/i);
  if (!arrow) return null;
  if (/^(↑|↓|More|Less|Over|Under)$/i.test(arrow[1])) {
    return {
      selectedSide: /^(↓|Less|Under)$/i.test(arrow[1]) ? "UNDER" : "OVER",
      executionLine: Number(arrow[2]),
      propLabel: String(arrow[3] || "").trim(),
    };
  }
  return {
    selectedSide: /^(Less|Under)$/i.test(arrow[3]) ? "UNDER" : "OVER",
    executionLine: Number(arrow[1]),
    propLabel: String(arrow[2] || "").trim(),
  };
}

function parseInlineLeg(line) {
  const m = String(line || "").match(
    /^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.']+){0,3})\s+(↑|↓|More|Less|Over|Under)\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/i,
  );
  if (!m) return null;
  return {
    playerName: m[1].trim(),
    selectedSide: /^(↓|Less|Under)$/i.test(m[2]) ? "UNDER" : "OVER",
    executionLine: Number(m[3]),
    propLabel: String(m[4] || "").trim(),
    propType: normalizePropType(m[4]),
  };
}

/**
 * Extract legs from OCR / paste text.
 * Supports:
 *   ↑ 0.5 Pass Attempts / ↓ 17.5 Rush Yards
 *   More 0.5 Pass Attempts / Less 17.5 Rush Yards
 *   Patrick Mahomes More 0.5 Pass Attempts
 * with a nearby player name line.
 */
function extractLegs(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((l) => l.replace(/[•·]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const legs = [];

  for (let i = 0; i < lines.length; i++) {
    const inline = parseInlineLeg(lines[i]);
    if (inline?.propLabel) {
      legs.push(inline);
      continue;
    }

    const proj = parseProjectionLine(lines[i]);
    if (!proj || !proj.propLabel) continue;
    let playerName = null;
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const cand = lines[j];
      if (isTeamMetaLine(cand)) continue;
      if (isPlayerNameLine(cand)) {
        playerName = cand;
        break;
      }
    }
    if (!playerName) continue;
    legs.push({
      playerName,
      selectedSide: proj.selectedSide,
      executionLine: proj.executionLine,
      propLabel: proj.propLabel,
      propType: normalizePropType(proj.propLabel),
    });
  }

  // Deduplicate identical legs.
  const seen = new Set();
  return legs.filter((leg) => {
    const key = `${leg.playerName}|${leg.selectedSide}|${leg.executionLine}|${leg.propType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function looksLikePrizePicksSlip(text = "", bookHint = "") {
  if (/prize\s*picks/i.test(bookHint)) return true;
  const t = String(text || "");
  if (/prize\s*picks/i.test(t)) return true;
  if (/\bpower\s*play\b/i.test(t) && /\d+\s*[- ]\s*pick/i.test(t)) return true;
  if (/\$\s*\d+(?:\.\d{1,2})?\s*to\s*win\s*\$\s*\d+/i.test(t) && /(↑|↓|\bMore\b|\bLess\b)/i.test(t)) {
    return true;
  }
  return false;
}

export async function parsePrizePicksSlip(text, { dateHint } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { tickets: [], totalRisk: null, totalToWin: null, entryType: null };

  const sport = detectSport(raw);
  const date = parseSlipDate(raw, dateHint);
  const stake = parseStake(raw);
  const entry = parseEntryType(raw);
  const matchup = detectMatchup(raw, sport);
  const legs = extractLegs(raw);

  if (!legs.length) {
    return {
      tickets: [],
      totalRisk: stake.riskAmount,
      totalToWin: stake.toWinAmount,
      entryType: entry.entryType,
      warnings: ["No PrizePicks legs detected — check OCR text"],
    };
  }

  const digest = await hashText(
    `${date}|${entry.label}|${stake.riskAmount}|${stake.potentialPayout}|${legs
      .map((l) => `${l.playerName}:${l.selectedSide}:${l.executionLine}:${l.propType}`)
      .join("|")}`,
  );
  const entryId = `PP-${digest.slice(0, 12).toUpperCase()}`;
  const executionPrice = americanFromPayout(stake.riskAmount, stake.potentialPayout);
  const warnings = [];
  if (stake.riskAmount == null || stake.potentialPayout == null) {
    warnings.push("Confirm stake and to-win amounts");
  }
  if (!matchup.awayTeam || !matchup.homeTeam) {
    warnings.push("Confirm matchup teams");
  }
  if (entry.pickCount != null && legs.length !== entry.pickCount) {
    warnings.push(`Slip says ${entry.pickCount}-pick but parsed ${legs.length} leg(s)`);
  }
  if (entry.entryType === "POWER_PLAY") {
    warnings.push("Power Play is all-or-nothing — grade every leg; stake is stored on leg 1");
  }

  const tickets = legs.map((leg, idx) => {
    const isPrimary = idx === 0;
    return {
      externalTicketId: `${entryId}-L${idx + 1}`,
      executionBook: "PrizePicks",
      executedAt: null,
      timezone: "America/Chicago",
      sport,
      date,
      matchupText: matchup.matchupText,
      awayTeam: matchup.awayTeam,
      homeTeam: matchup.homeTeam,
      awayIdentity: matchup.awayIdentity,
      homeIdentity: matchup.homeIdentity,
      market: "PLAYER_PROP",
      period: "FG",
      selectedSide: leg.selectedSide,
      selectedTeam: leg.playerName,
      playerName: leg.playerName,
      propType: leg.propType,
      executionLine: leg.executionLine,
      executionPrice: isPrimary ? executionPrice : null,
      riskAmount: isPrimary ? stake.riskAmount : 0,
      toWinAmount: isPrimary ? stake.toWinAmount : 0,
      potentialPayout: isPrimary ? stake.potentialPayout : null,
      currency: "USD",
      importSource: "prizepicks-screenshot-ocr",
      rawText: raw,
      entryType: entry.entryType,
      entryLabel: entry.label,
      entryId,
      legIndex: idx + 1,
      legCount: legs.length,
      propLabel: leg.propLabel,
      clvStatus: "unavailable",
      warnings: [
        ...warnings,
        `PrizePicks ${entry.label || "entry"} leg ${idx + 1}/${legs.length}: ${leg.playerName} ${leg.selectedSide} ${leg.executionLine} ${leg.propLabel}`,
      ],
    };
  });

  return {
    tickets,
    totalRisk: stake.riskAmount,
    totalToWin: stake.toWinAmount,
    entryType: entry.entryType,
    entryId,
  };
}
