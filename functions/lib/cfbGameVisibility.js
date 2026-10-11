// Verified 2026 canonical ESPN membership; no name-based identity inference.
const FBS_2026 = new Set(["103", "113", "12", "120", "127", "130", "135", "142", "145", "150", "151", "152", "153", "154", "158", "16", "164", "166", "167", "183", "189", "193", "194", "195", "197", "2", "2005", "2006", "201", "202", "2026", "2032", "204", "2050", "2084", "21", "2116", "2117", "213", "2132", "218", "2199", "221", "2226", "2229", "2247", "228", "2294", "23", "2305", "2306", "2309", "2335", "2348", "235", "238", "239", "2390", "2393", "24", "242", "2426", "2429", "2433", "2439", "2440", "2449", "245", "2459", "248", "2483", "249", "25", "2509", "251", "252", "2534", "254", "256", "2567", "2572", "2579", "258", "259", "26", "2623", "2628", "2633", "2636", "2638", "264", "2641", "2649", "265", "2653", "2655", "2711", "275", "2751", "276", "277", "278", "290", "295", "30", "309", "324", "326", "328", "333", "338", "344", "349", "356", "36", "38", "41", "48", "5", "52", "55", "57", "58", "59", "6", "61", "62", "66", "68", "77", "8", "84", "87", "9", "96", "97", "98", "99"]);
export function isFbsVsFbsGame(game) {
  if (String(game?.sport || '').toLowerCase() !== 'cfb') return true;
  const season = Number(game.season || String(game.start || '').slice(0, 4));
  return ['home', 'away'].every(side => {
    const team = game[side] || {};
    const classification = String(team.classification || '').trim().toUpperCase();
    // Explicit provider classification takes precedence over current membership.
    if (classification && classification !== 'FBS') return false;
    if (team.classificationSource === 'CFBD') return classification === 'FBS';
    return season === 2026 && FBS_2026.has(String(team.espnId || ''));
  });
}
export function fbsOnlySlate(payload) {
  if (payload?.sport !== 'cfb') return payload;
  const before = payload.games || [];
  const games = before.filter(isFbsVsFbsGame);
  const ids = new Set(games.map(game => String(game.id)));
  return {...payload, games, ticker: (payload.ticker || []).filter(row => ids.has(String(row.id))),
    counts: {...payload.counts, games: games.length, live: games.filter(g=>g.status?.live).length,
      final: games.filter(g=>g.status?.completed).length,
      upcoming: games.filter(g=>!g.status?.completed && !g.status?.live).length},
    cfbGameVisibility: {scope: 'FBS_VS_FBS', withheld: before.length-games.length}};
}
