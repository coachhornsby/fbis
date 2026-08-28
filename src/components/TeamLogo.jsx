import { useState } from "react";
import { displayTeamIdentity, teamDisplayName } from "../../functions/lib/teams.js";

export default function TeamLogo({ team, size = 22 }) {
  const [failed, setFailed] = useState(false);
  const name = teamDisplayName(team) === "—" ? "Team" : teamDisplayName(team);
  const abbr = team?.abbr && team.abbr !== "—" ? team.abbr : "";
  if (!team?.logo || failed) {
    return (
      <span
        className="team-logo-fallback"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.38) }}
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
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function TeamIdentity({ team, score }) {
  const name = teamDisplayName(team);
  const abbr = team?.abbr && team.abbr !== "—" ? team.abbr : "";
  return (
    <div className="team-line">
      <TeamLogo team={team} />
      <span className="team-name">{name}</span>
      {abbr ? <span className="muted team-abbr">{abbr}</span> : null}
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
      <TeamIdentity team={away} />
      <TeamIdentity team={home} />
      {!named && matchupText ? <div className="muted">{matchupText}</div> : null}
    </div>
  );
}
