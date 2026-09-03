import { hashText } from "./heritageSlip.js";
import { identityForSport } from "./teams.js";

function ctDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function moneyAfter(label, text) {
  const match = text.match(new RegExp(`${label}\\s*\\$?([0-9]+(?:\\.[0-9]{1,2})?)`, "i"));
  return match ? Number(match[1]) : null;
}

function americanFromPayout(risk, payout) {
  const profit = Number(payout) - Number(risk);
  if (!(risk > 0) || !(profit > 0)) return null;
  return Math.round(profit >= risk ? (profit / risk) * 100 : -(risk / profit) * 100);
}

function placedAt(text, date) {
  const match = text.match(/Placed\s*:?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${date}T${String(hour).padStart(2, "0")}:${match[2]}:00-05:00`;
}

export async function parseNoVigSlip(text, { dateHint } = {}) {
  const cleaned = String(text || "").replace(/•/g, " ").replace(/\s+/g, " ").trim();
  const prop = cleaned.match(/([A-Za-z][A-Za-z .'-]+?)\s+([UO]|Under|Over)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!prop) return { tickets: [], totalRisk: null, totalToWin: null };
  const date = dateHint || ctDate();
  const selectedSide = /^(u|under)$/i.test(prop[2]) ? "UNDER" : "OVER";
  const playerName = prop[1].replace(/^NOVIG\s*/i, "").trim();
  const executionLine = Number(prop[3]);
  const dollars = [...cleaned.matchAll(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/g)].map((m) => Number(m[1]));
  const riskAmount = moneyAfter("Amount", cleaned) ?? dollars[0] ?? null;
  let potentialPayout = moneyAfter("To\\s*Pay", cleaned);
  if (potentialPayout == null || potentialPayout <= riskAmount) potentialPayout = dollars[1] ?? potentialPayout;
  const toWinAmount = riskAmount != null && potentialPayout != null
    ? Math.round((potentialPayout - riskAmount) * 100) / 100
    : null;
  const teams = cleaned.match(/\b([A-Z]{2,4})\s+(?:Live\s*)?(?:[▲△]?\s*\d+(?:st|nd|rd|th))?\s*\d+\s*[-–]\s*\d+\s+([A-Z]{2,4})\b/)
    || cleaned.match(/\b([A-Z]{2,4})\s+\d+\s*[-–]\s*\d+\s+([A-Z]{2,4})\b/);
  const awayAbbr = teams?.[1] || null;
  const homeAbbr = teams?.[2] || null;
  const awayIdentity = identityForSport("mlb", awayAbbr);
  const homeIdentity = identityForSport("mlb", homeAbbr);
  const awayTeam = awayIdentity.canonicalId ? awayIdentity.name : awayAbbr;
  const homeTeam = homeIdentity.canonicalId ? homeIdentity.name : homeAbbr;
  const digest = await hashText(`${date}|${playerName}|${selectedSide}|${executionLine}|${riskAmount}|${potentialPayout}|${placedAt(cleaned, date)}`);
  const warnings = [];
  if (!awayTeam || !homeTeam) warnings.push("Confirm both teams");
  if (riskAmount == null || potentialPayout == null) warnings.push("Confirm amount and payout");
  if (!placedAt(cleaned, date)) warnings.push("Confirm placement time");
  return {
    tickets: [{
      externalTicketId: `NOVIG-${digest.slice(0, 16).toUpperCase()}`,
      executionBook: "NoVig",
      executedAt: placedAt(cleaned, date),
      timezone: "America/Chicago",
      sport: "mlb",
      date,
      matchupText: awayTeam && homeTeam ? `${awayTeam} @ ${homeTeam}` : null,
      awayTeam,
      homeTeam,
      awayIdentity,
      homeIdentity,
      market: "PLAYER_PROP",
      period: "FG",
      selectedSide,
      selectedTeam: playerName,
      playerName,
      propType: /strikeouts?\s+thrown/i.test(cleaned) ? "PITCHER_STRIKEOUTS" : "PLAYER_PROP",
      executionLine,
      executionPrice: americanFromPayout(riskAmount, potentialPayout),
      riskAmount,
      toWinAmount,
      potentialPayout,
      currency: "USD",
      importSource: "novig-screenshot-ocr",
      rawText: cleaned,
      warnings,
    }],
    totalRisk: riskAmount,
    totalToWin: toWinAmount,
  };
}
