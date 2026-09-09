import { useState } from "react";
import { displayTeamIdentity, teamDisplayName } from "../../functions/lib/teams.js";

export default function TeamLogo({ team, size = 22 }) {
  const [failed, setFailed] = useState(false);
  const name = teamDisplayName(team) === "—" ? "Team" : teamDisplayName(team);
  const abbr = team?.abbr && team.abbr !== "—" ? team.abbr : "";
  const px = Number(size) || 22;
  if (!team?.logo || failed) {
    return (
      <span
        className="team-logo-fallback"
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.36) }}
        title={name}
        aria-label={name}
      >
        {abbr || "?"}
      </span>
    );
  }
  return (
    <img
      className="team-logo"
      src={team.logo}
      alt={name}
      width={px}
      height={px}
      style={{ width: px, height: px }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function TeamIdentity({ team, score, size = 22, compact = false }) {
  const name = teamDisplayName(team);
  const abbr = team?.abbr && team.abbr !== "—" ? team.abbr : "";
  const px = Number(size) || 22;
  return (
    <div className={`team-line${px >= 36 ? " team-line-lg" : ""}`}>
      <TeamLogo team={team} size={px} />
      <div className="team-text">
        <span className="team-name">{name}</span>
        {!compact && abbr ? <span className="muted team-abbr">{abbr}</span> : null}
      </div>
      {score != null ? <span className="score-accent">{score}</span> : null}
    </div>
  );
}

export function TicketMatchup({ awayIdentity, homeIdentity, awayTeam, homeTeam, matchupText }) {
  const away = displayTeamIdentity(awayIdentity, awayTeam);
  const home = displayTeamIdentity(homeIdentity, homeTeam);
  const named = teamDisplayName(away) !== "—" && teamDisplayName(home) !== "—";
  return (
    <div className="team-block">
      <TeamIdentity team={away} size={28} />
      <TeamIdentity team={home} size={28} />
      {!named && matchupText ? <div className="muted">{matchupText}</div> : null}
    </div>
  );
}
