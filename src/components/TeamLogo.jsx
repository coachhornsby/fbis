import { useMemo, useState } from "react";
import { displayTeamIdentity } from "../../functions/lib/teams.js";
import {
  logoSizePx,
  teamDisplayName,
  teamIdentityFromTeam,
} from "../../functions/lib/teamIdentity.js";

/**
 * Canonical team mark.
 *
 * size: "hero" | "card" | "compact" | "micro" | number(px)
 * Prefer passing sport when known so abbr collisions stay league-scoped.
 */
export default function TeamLogo({
  team,
  sport = null,
  size = "compact",
  decorative = false,
  className = "",
  alt = null,
}) {
  const [failed, setFailed] = useState(false);
  const identity = useMemo(() => {
    if (team?.logo?.primaryUrl != null && (team.canonicalTeamId || team.abbreviation)) {
      return team;
    }
    return teamIdentityFromTeam(team, sport || team?.sport || null);
  }, [team, sport]);

  const px = logoSizePx(size);
  const sizeToken =
    typeof size === "string" && ["hero", "card", "compact", "micro"].includes(size) ? size : null;
  const name =
    identity.fullName ||
    identity.shortName ||
    teamDisplayName(team) ||
    identity.abbreviation ||
    "Team";
  const abbr = identity.abbreviation || (team?.abbr && team.abbr !== "—" ? team.abbr : "") || "";
  const logoUrl =
    identity.logo?.primaryUrl ||
    (typeof team?.logo === "string" ? team.logo : "") ||
    team?.logoUrl ||
    "";
  const primary = identity.colors?.primary || null;
  const label = alt || `${name} logo`;

  if (!logoUrl || failed) {
    return (
      <span
        className={`team-logo team-logo-fallback${sizeToken ? ` team-logo--${sizeToken}` : ""}${
          className ? ` ${className}` : ""
        }`}
        style={{
          width: px,
          height: px,
          fontSize: Math.max(9, Math.round(px * 0.34)),
          ...(primary ? { borderColor: primary } : null),
        }}
        title={name}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative ? "true" : undefined}
        role={decorative ? "presentation" : "img"}
      >
        {abbr || "?"}
      </span>
    );
  }

  return (
    <img
      className={`team-logo${sizeToken ? ` team-logo--${sizeToken}` : ""}${className ? ` ${className}` : ""}`}
      src={logoUrl}
      alt={decorative ? "" : label}
      aria-hidden={decorative ? "true" : undefined}
      width={px}
      height={px}
      style={{ width: px, height: px }}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Logo + name (+ optional record/score) using the canonical identity contract.
 */
export function TeamIdentity({
  team,
  sport = null,
  size = "compact",
  score = null,
  record = null,
  showAbbreviation = true,
  showName = true,
  compact = false,
  orientation = "horizontal",
  className = "",
}) {
  const identity = useMemo(
    () => teamIdentityFromTeam(team, sport || team?.sport || null),
    [team, sport],
  );
  const px = logoSizePx(size);
  const name = identity.fullName || identity.shortName || teamDisplayName(team) || "—";
  const abbr = identity.abbreviation || "";
  const shownRecord = record ?? identity.record ?? null;
  const vertical = orientation === "vertical";

  return (
    <div
      className={`team-line${px >= 40 ? " team-line-lg" : ""}${vertical ? " team-line-vertical" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      <TeamLogo team={identity} sport={identity.sport} size={size} />
      {showName || showAbbreviation ? (
        <div className="team-text">
          {showName ? <span className="team-name">{compact && abbr ? abbr : name}</span> : null}
          {showAbbreviation && !compact && abbr ? <span className="muted team-abbr">{abbr}</span> : null}
          {shownRecord ? <span className="muted team-record">{shownRecord}</span> : null}
        </div>
      ) : null}
      {score != null ? <span className="score-accent">{score}</span> : null}
    </div>
  );
}

/** Existing bets / heritage matchup block — same API as before. */
export function TicketMatchup({
  awayIdentity,
  homeIdentity,
  awayTeam,
  homeTeam,
  matchupText,
  sport = null,
}) {
  const away = displayTeamIdentity(awayIdentity, awayTeam);
  const home = displayTeamIdentity(homeIdentity, homeTeam);
  const named = teamDisplayName(away) !== "—" && teamDisplayName(home) !== "—";
  return (
    <div className="team-block">
      <TeamIdentity team={away} sport={sport} size="compact" />
      <TeamIdentity team={home} sport={sport} size="compact" />
      {!named && matchupText ? <div className="muted">{matchupText}</div> : null}
    </div>
  );
}

export { teamIdentityFromTeam, logoSizePx };
