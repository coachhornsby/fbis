import TeamLogo from "../../components/TeamLogo.jsx";
import {
  galleryTeamSamples,
  listRegistryCoverage,
  LOGO_SIZES,
} from "../../../functions/lib/teamIdentity.js";

const SIZE_ORDER = ["hero", "card", "compact", "micro"];

/**
 * Dev-only visual QA surface for the canonical team identity / logo system.
 * Route: #/dev/team-identities (not linked in primary IA).
 */
export default function TeamIdentityGallery() {
  const samples = galleryTeamSamples();
  const coverage = listRegistryCoverage();

  return (
    <div className="team-id-gallery">
      <h1>Team identity / logos</h1>
      <p className="lede">
        Canonical FBIS marks from the sport registries (ESPN CDN). Hero {LOGO_SIZES.hero}px · Card{" "}
        {LOGO_SIZES.card}px · Compact {LOGO_SIZES.compact}px · Micro {LOGO_SIZES.micro}px. NHL has no
        registry yet — fallback badges only.
      </p>

      <div className="team-id-coverage" aria-label="Registry coverage">
        {Object.entries(coverage).map(([sport, row]) => (
          <span key={sport}>
            {sport.toUpperCase()} {row.withLogo}/{row.teams}
            {row.note ? " · no pack" : ""}
          </span>
        ))}
      </div>

      {["mlb", "nfl", "nba", "nhl", "cfb", "cbb"].map((sport) => {
        const rows = samples[sport] || [];
        return (
          <section key={sport} className="team-id-sport" aria-labelledby={`team-id-${sport}`}>
            <h2 id={`team-id-${sport}`}>{sport.toUpperCase()}</h2>
            {!rows.length ? (
              <p className="note">
                {coverage[sport]?.note || "No sample teams resolved for this sport."}
              </p>
            ) : (
              <div className="team-id-row">
                {rows.map((team) => (
                  <article key={team.canonicalTeamId || team.abbreviation} className="team-id-card">
                    <div className="sizes" aria-label={`${team.abbreviation} size ladder`}>
                      {SIZE_ORDER.map((sz) => (
                        <TeamLogo key={sz} team={team} sport={sport} size={sz} />
                      ))}
                    </div>
                    <div className="meta">
                      <strong>{team.abbreviation || "—"}</strong>
                      <span>{team.fullName || team.shortName || "—"}</span>
                      <span className="muted">
                        {team.logo.source}
                        {team.colors.primary ? ` · ${team.colors.primary}` : ""}
                      </span>
                    </div>
                    <TeamLogo
                      team={{
                        ...team,
                        logo: { ...team.logo, primaryUrl: "", available: false },
                      }}
                      sport={sport}
                      size="compact"
                      alt={`${team.abbreviation || "team"} fallback`}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
