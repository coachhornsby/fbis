/**
 * NHL official model artifact uses NHL tricodes; ESPN often publishes legacy
 * display abbreviations. Keep this translation in the research INPUT boundary.
 * Do not rewrite event identity, persisted tickets or display team codes.
 */
const ALIASES = Object.freeze({
  LA:"LAK", SJ:"SJS", TB:"TBL", NJ:"NJD",
  L.A:"LAK", "N.J":"NJD", "S.J":"SJS", "T.B":"TBL",
});
export function nhlModelTeamCode(team) {
  const t=String(team||"").trim().toUpperCase();
  return ALIASES[t]||t;
}
