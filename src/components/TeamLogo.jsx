import { useEffect, useState } from "react";
import { resolveTeamLogo } from "../lib/resolveTeamLogo.js";
import { displayTeamIdentity, teamDisplayName, identityForSport } from "../../functions/lib/teams.js";

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
const REMOTE_LOGO_CACHE = new Map();

export default function TeamLogo({
  team,
  size = 22,
  tone = "auto",
  className = "",
  title,
}) {
  const [failed, setFailed] = useState(false);
  const [remote, setRemote] = useState(null);
  const resolved = resolveTeamLogo(team);
  const px = resolveSize(size);
  const name = resolved.name;
  const abbr = remote?.abbr || resolved.abbr;
  const sport = String(team?.sport || "").toLowerCase();
  const baseUrl = resolved.url;
  const url = remote?.logo || (!failed ? baseUrl : null);
  const plate = tone === "dark" || tone === "auto";

  useEffect(() => {
    setFailed(false);
    setRemote(null);
    if ((baseUrl && !failed) || !name || !["soccer","nhl","npb","kbo"].includes(sport)) return;
    const key = sport + "|" + String(name).toLowerCase();
    const cached = REMOTE_LOGO_CACHE.get(key);
    if (cached?.value) {
      setRemote(cached.value);
      return;
    }
    if (cached?.promise) {
      cached.promise.then((value) => value && setRemote(value)).catch(() => {});
      return;
    }
    const promise = fetch(`/api/team-logo?sport=${encodeURIComponent(sport)}&name=${encodeURIComponent(name)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((body) => body?.found ? body.team : null)
      .catch(() => null)
      .then((value) => {
        REMOTE_LOGO_CACHE.set(key, { value });
        return value;
      });
    REMOTE_LOGO_CACHE.set(key, { promise });
    promise.then((value) => value && setRemote(value)).catch(() => {});
  }, [baseUrl, failed, name, sport]);

  const markSize = plate ? px * 0.78 : px;

  if (!url) {
    return (
      <span
        className={`team-logo-fallback${plate ? " team-logo-plate" : ""}${className ? ` ${className}` : ""}`}
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.34) }}
        title={title || name}
        aria-label={title || name}
        role="img"
      >
        {abbr && abbr !== "—" ? abbr.slice(0, 4) : (
          <svg width={Math.round(px * .48)} height={Math.round(px * .48)} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="M12 2.5 20 6v5.8c0 5.2-3.3 8.1-8 10-4.7-1.9-8-4.8-8-10V6l8-3.5Z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".65" />
          </svg>
        )}
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
        style={{ width: markSize, height: markSize }}
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

export function TicketMatchup({ awayIdentity, homeIdentity, awayTeam, homeTeam, matchupText, sport }) {
  let awayName = awayTeam;
  let homeName = homeTeam;
  if ((!awayName || !homeName) && matchupText) {
    const parts = String(matchupText).split(/\s+(?:@|vs\.?|v)\s+/i);
    if (parts.length === 2) {
      awayName = awayName || parts[0].trim();
      homeName = homeName || parts[1].trim();
    }
  }
  const sportId = String(sport || awayIdentity?.sport || homeIdentity?.sport || "").toLowerCase();
  const awayResolved = sportId && awayName ? identityForSport(sportId, awayName) : awayIdentity;
  const homeResolved = sportId && homeName ? identityForSport(sportId, homeName) : homeIdentity;
  const away = displayTeamIdentity(awayResolved || awayIdentity, awayName);
  const home = displayTeamIdentity(homeResolved || homeIdentity, homeName);
  const named = teamDisplayName(away) !== "—" && teamDisplayName(home) !== "—";
  return (
    <div className="team-block">
      <TeamIdentity team={away} size={36} tone="dark" />
      <TeamIdentity team={home} size={36} tone="dark" />
      {!named && matchupText ? <div className="muted">{matchupText}</div> : null}
    </div>
  );
}
