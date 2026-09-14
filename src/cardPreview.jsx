import React from "react";
import { createRoot } from "react-dom/client";
import PremiumGameCard from "./components/board/PremiumGameCard.jsx";
import "./index.css";
import "./styles/venueAtmosphere.css";

const mlb = {
  id: "mlb-preview",
  sport: "mlb",
  start: "2026-09-14T22:40:00Z",
  venue: "Rate Field, Chicago, IL",
  away: {
    abbr: "CHW",
    name: "White Sox",
    fullName: "Chicago White Sox",
    record: "58-84",
    logo: "https://a.espncdn.com/i/teamlogos/mlb/500/chw.png",
  },
  home: {
    abbr: "CLE",
    name: "Guardians",
    fullName: "Cleveland Guardians",
    record: "78-63",
    logo: "https://a.espncdn.com/i/teamlogos/mlb/500/cle.png",
  },
  model: { projAway: 4.3, projHome: 4.0, projTotal: 8.3, projMargin: -0.3 },
  projectionKind: "FBIS",
  projectionState: "COMPLETE",
  rec: { tag: "QUALIFIED", pick: "CLE -1.5", market: "spread", edge: 0.12 },
  decision: { qualification: "QUALIFIED", tier: "QUALIFIED", label: "QUALIFIED" },
  market: {
    marketAvailable: true,
    execution: {
      available: true,
      book: "FanDuel",
      spread: -1.5,
      total: 6.5,
      moneyline: { home: -150, away: 130 },
    },
  },
  actionIntel: {
    publicSplits: {
      ticketPct: 34,
      moneyPct: 78,
      moneyTicketGap: 44,
      sharpLabel: null,
    },
    movement: { openingLine: -1, currentLine: -1.5, movementMagnitude: -0.5 },
    booksCount: 4,
    sampleSize: 12600,
    lineRange: { low: -1.5, high: -2.0 },
    collectedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  publicSplits: { ticketPct: 34, moneyPct: 78, moneyTicketGap: 44 },
  awaySp: { name: "C. Flexen", hand: "R" },
  homeSp: { name: "T. Bibee", hand: "R" },
  savant: { awaySpEra: 3.72, homeSpEra: 3.47 },
  weather: {
    temperature: 78,
    windSpeed: 8,
    windDirection: "L->R",
    description: "Partly Cloudy",
  },
};

const nfl = {
  ...mlb,
  id: "nfl-preview",
  sport: "nfl",
  venue: "Levi's Stadium, Santa Clara, CA",
  away: {
    abbr: "SF",
    name: "49ers",
    fullName: "San Francisco 49ers",
    record: "3-0",
    logo: "https://a.espncdn.com/i/teamlogos/nfl/500/sf.png",
  },
  home: {
    abbr: "LAR",
    name: "Rams",
    fullName: "Los Angeles Rams",
    record: "2-1",
    logo: "https://a.espncdn.com/i/teamlogos/nfl/500/lar.png",
  },
  model: { projAway: 24.1, projHome: 20.4, projTotal: 44.5, projMargin: 3.7 },
  market: {
    marketAvailable: true,
    execution: { available: true, book: "DraftKings", spread: 3.5, total: 46.5 },
  },
  awaySp: null,
  homeSp: null,
  savant: null,
};

function Preview() {
  return (
    <div style={{ padding: 24, background: "#050a12", minHeight: "100vh" }}>
      <h1 style={{ color: "#fff", fontFamily: "system-ui", marginBottom: 16 }}>
        Premium card preview
      </h1>
      <div style={{ display: "grid", gap: 24, maxWidth: 1120 }}>
        <PremiumGameCard game={mlb} open={false} onToggle={() => {}} />
        <PremiumGameCard game={nfl} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
