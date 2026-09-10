import { useState } from "react";
import { fmtNum } from "../lib/format.js";

export function challengerOptions(game) {
  const c = game?.challengers || {};
  const ids = Object.keys(c).filter((id) => c[id] && (c[id].home != null || c[id].ok === false));
  return ids;
}

export function ChallengerSelect({ game, championHome, championAway }) {
  const ids = challengerOptions(game);
  const [sel, setSel] = useState("champion");
  if (!ids.length) return null;
  const c = sel === "champion" ? null : game.challengers[sel];
  const home = c?.home ?? championHome;
  const away = c?.away ?? championAway;
  return (
    <div className="challenger-block">
      <select
        className="challenger-select"
        aria-label="Champion versus challenger"
        value={sel}
        onChange={(e) => setSel(e.target.value)}
      >
        <option value="champion">Champion {game.championModel || "FBIS-v1.3"}</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}{game.challengers[id]?.marketInformed ? " · market-informed" : ""} · shadow
          </option>
        ))}
      </select>
      {sel !== "champion" && (
        <>
          <div className="muted">
            {c?.home != null ? `${fmtNum(away)} – ${fmtNum(home)}` : c?.reason || "unavailable"}
          </div>
          <div className="muted">shadow · cannot qualify</div>
        </>
      )}
    </div>
  );
}
