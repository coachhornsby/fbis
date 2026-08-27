import { useState } from "react";

export default function TeamLogo({ team, size = 22 }) {
  const [failed, setFailed] = useState(false);
  const name = team?.fullName || team?.school || team?.name || "Team";
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
  const name = team?.school || team?.fullName || team?.name || "—";
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
