/**
 * Read-only NCAA nameplate. Displays verified FULL school and mascot names,
 * each on one centered line at the SAME adaptive font size.
 * Its length variable is used only for responsive typography.
 */
export default function CollegeTeamName({ identity = {}, className = "" }) {
  const school = String(identity.school || "—");
  const mascot = identity.mascot ? String(identity.mascot) : null;
  const maxLength = mascot ? Math.max(school.length, mascot.length, 3) : null;
  return (
    <strong
      className={`${className}${mascot ? " fbis-college-team-name" : ""}`}
      style={mascot ? { "--fbis-college-label-length": maxLength } : undefined}
      aria-label={mascot ? `${school} ${mascot}` : undefined}
    >
      {mascot ? (
        <>
          <span className="fbis-college-school">{school}</span>
          <span className="fbis-college-mascot">{mascot}</span>
        </>
      ) : school}
    </strong>
  );
}
