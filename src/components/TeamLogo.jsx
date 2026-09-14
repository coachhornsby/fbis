import { useState } from "react";
import { resolveTeamLogo } from "../lib/resolveTeamLogo.js";
import { displayTeamIdentity, teamDisplayName } from "../../functions/lib/teams.js";

/** Named sizes for board / card hierarchy. */
export const LOGO_SIZES = Object.freeze({
  hero: 56,
  card: 44,
  compact: 28,
  micro: 18,
});

/**
 * Team logo with contrast plate for dark venue cards.
 * Dark ESPN marks (NYY, PSU, etc.) get a light disk so they stay readable.
 */
export default function TeamLogo({
  team,
  size = 22,
  tone = "auto",
  className = "",
  title,
}) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveTeamLogo(team);
  const px = resolveSize(size);
  const name = resolved.name;
  const abbr = resolved.abbr;
  const url = !failed ? resolved.url : null;
  const plate = tone === "dark" || tone === "auto";

  if (!url) {
    return (
      <span
        className={`team-logo-fallback team-logo-plate${className ? ` ${className}` : ""}`}
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.34) }}
        title={title || name}
        aria-label={title || name}
        role="img"
      >
        {abbr && abbr !== "—" ? abbr.slice(0, 4) : "?"}
      </span>
    );
  }

  return (
    <span
      className={`team-logo-wrap${plate ? " team-logo-plate" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: px, height: px }}
      title={title || name}
    >
      <img
        className="team-logo"
        src={url}
        alt={`${name} logo`}
        width={px}
        height={px}
        style={{ width: px * 0.78, height: px * 0.78 }}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function resolveSize(size) {
  if (typeof size === "string" && LOGO_SIZES[size] != null) return LOGO_SIZES[size];
  const n = Number(size);
  return Number.isFinite(n) && n > 0 ? n : 22;
}

export function TeamIdentity({ team, score, size = 22, compact = false, tone = "auto" }) {
  const name = teamDisplayName(team);
  const abbr = team?.abbr && team.abbr !== "—" ? team.abbr : "";
  const px = resolveSize(size);
  return (
    <div className={`team-line${px >= 36 ? " team-line-lg" : ""}`}>
      <TeamLogo team={team} size={px} tone={tone} />
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
      <TeamIdentity team={away} size={28} tone="dark" />
      <TeamIdentity team={home} size={28} tone="dark" />
      {!named && matchupText ? <div className="muted">{matchupText}</div> : null}
    </div>
  );
}
