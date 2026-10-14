import { normalizeSoccerName } from './soccerPitchApiStore.js';

// Verified by provider-name/ID comparisons in production PitchAPI ger.1 history.
// Competition scope prevents short display aliases (e.g. Mainz) from leaking
// into another league or becoming a cross-provider numeric-ID match.
const VERIFIED_ALIASES = Object.freeze({
  'ger.1': Object.freeze({
    'bayern munich': 'bayern munchen',
    'hamburg sv': 'hamburger sv',
    '1 union berlin': 'union berlin',
    'mainz': 'mainz 05',
    'sv elversberg': 'elversberg',
    'paderborn 07': 'paderborn',
  }),
});

export function pitchApiTeamNameKey(name, leagueKey = '') {
  const normalized = normalizeSoccerName(name);
  return VERIFIED_ALIASES[leagueKey]?.[normalized] || normalized;
}

export function matchesPitchApiTeamName(a, b, leagueKey = '') {
  const left = pitchApiTeamNameKey(a, leagueKey);
  const right = pitchApiTeamNameKey(b, leagueKey);
  return Boolean(left && right && left === right);
}
