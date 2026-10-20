/**
 * Basketball player-prop watermark identity.
 *
 * Provider team codes are not the same as the ESPN/canonical catalog codes
 * (GSW vs GS, SAS vs SA, NYK vs NY, etc.). Resolve ONLY the player's team,
 * never infer ownership from an opponent, venue, matchup side, or market title.
 * Ambiguity and contradictory evidence fail closed without a watermark.
 */
import { resolveTeamExact } from './teams.js';

export const BASKETBALL_PROP_SPORTS = Object.freeze(['nba', 'wnba', 'cbb']);
const BASKETBALL_SET = new Set(BASKETBALL_PROP_SPORTS);

// Values point to canonical FBIS registry abbreviations, not ESPN or market IDs.
const ALIASES = Object.freeze({
  nba: Object.freeze({
    BRK:'BKN', BK:'BKN', GSW:'GS', GS:'GS', NOP:'NO', NOH:'NO',
    NYK:'NY', SAS:'SA', PHO:'PHX', UTA:'UTAH', UTAH:'UTAH',
    WSH:'WAS', CHO:'CHA',
  }),
  wnba: Object.freeze({
    LV:'LVA', LVA:'LVA', LA:'LAS', NY:'NYL', GS:'GSV',
    PHO:'PHX', WSH:'WAS',
  }),
  cbb: Object.freeze({}),
});

function findTeam(sport, input) {
  if (!input) return null;
  if (typeof input === 'object') {
    if (input.sport && String(input.sport).toLowerCase() !== sport) return null;
    return resolveTeamExact(sport, {
      canonicalId: input.canonicalId || input.id,
      espnId: input.espnId,
      abbr: input.abbr || input.abbreviation,
      name: input.name || input.displayName || input.school || input.fullName,
    });
  }
  const name = String(input).trim();
  if (!name) return null;
  const compact = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const alias = ALIASES[sport]?.[compact];
  return resolveTeamExact(sport, { abbr: alias || compact, name });
}
function color(value) {
  const raw = String(value || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(raw) ? '#' + raw.replace(/^#/, '') : '';
}
function unresolved(status, sport, source = '') {
  return { status, sport, canonicalId: null, teamAbbr: '', teamName: '', logo: '',
    primary: '', secondary: '', source };
}

/**
 * @returns resolved team, or explicit failure state. Safe for card rendering
 * and coverage counting; no network requests and no provider-side mutation.
 */
export function resolveBasketballPropTeam(row = {}) {
  const sport = String(row.sport || '').toLowerCase();
  if (!BASKETBALL_SET.has(sport)) return unresolved('not_basketball', sport);
  const inputs = [
    ['team', row.team],
    ['playerTeam', row.playerTeam],
    ['player_team', row.player_team],
    ['playerTeamAbbr', row.playerTeamAbbr],
    ['team_abbr', row.team_abbr],
    ['teamIdentity', row.teamIdentity],
  ];
  let team = null, source = '';
  for (const [field, value] of inputs) {
    const match = findTeam(sport, value);
    if (!match) continue;
    if (team && team.id !== match.id) return unresolved('conflict', sport, field);
    if (!team) { team = match; source = field; }
  }
  if (!team) return unresolved('unresolved', sport);
  // These are checks only. Neither opponent nor game home/away can establish
  // which team a player belongs to.
  const opponent = findTeam(sport, row.opponent);
  if (opponent?.id === team.id) return unresolved('event_mismatch', sport, 'opponent');
  const home = findTeam(sport, row.home_abbr || row.homeAbbr);
  const away = findTeam(sport, row.away_abbr || row.awayAbbr);
  if (home && away && home.id !== away.id &&
      team.id !== home.id && team.id !== away.id) {
    return unresolved('event_mismatch', sport, 'event');
  }
  const logo = /^https:\/\//i.test(String(team.logo || '')) ? team.logo : '';
  if (!logo) return unresolved('no_logo', sport, source);
  return {
    status: 'resolved', sport, canonicalId: team.id,
    teamAbbr: team.abbr, teamName: team.displayName || team.school || '',
    logo, primary: color(team.color || team.primaryColor),
    secondary: color(team.altColor || team.secondaryColor), source,
  };
}

/** Board diagnostics reflect displayed grouped cards, not raw quote counts. */
export function basketballPropWatermarkCoverage(rows = []) {
  const unresolvedRows = [];
  let total = 0, resolved = 0;
  const counts = { nba: 0, wnba: 0, cbb: 0 };
  for (const row of rows) {
    const sport = String(row?.sport || '').toLowerCase();
    if (!BASKETBALL_SET.has(sport)) continue;
    total++;
    counts[sport]++;
    const team = resolveBasketballPropTeam(row);
    if (team.status === 'resolved') resolved++;
    else unresolvedRows.push({
      sport, player: String(row?.player_name || row?.playerName || ''),
      team: String(row?.team || ''), status: team.status,
    });
  }
  return { total, resolved, unresolved: total - resolved, bySport: counts, unresolvedRows };
}
