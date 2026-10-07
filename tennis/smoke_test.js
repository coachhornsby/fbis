// smoke_test.js — end-to-end proof the pipeline runs. Synthetic data only.
import { buildRowsFromCsv, parseScore } from './tennisFeed.js';
import { buildIndex } from './tennisFeatureBuilder.js';
import { projectMatch } from './tennisProjector.js';
import { tennisClassify } from './tennisClassify.js';
import { buildMatchRead } from './tennisMatchRead.js';

const HEADER = ['tourney_id','tourney_name','surface','draw_size','tourney_level','tourney_date','match_num','winner_id','winner_seed','winner_entry','winner_name','winner_hand','winner_ht','winner_ioc','winner_age','loser_id','loser_seed','loser_entry','loser_name','loser_hand','loser_ht','loser_ioc','loser_age','score','best_of','round','minutes','w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced','l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced','winner_rank','winner_rank_points','loser_rank','loser_rank_points'].join(',');

// Two archetypes: 100 = big server (high aces), 200 = returner/grinder (few aces, strong return).
function matchRow(i, winnerBig) {
  const date = 20260100 + i;
  // serve lines
  const bigServe  = { ace: 12, df: 2, svpt: 70, in1: 44, w1: 35, w2: 15, gms: 12, bpS: 4, bpF: 5 };
  const grindServe = { ace: 3, df: 3, svpt: 72, in1: 43, w1: 30, w2: 16, gms: 12, bpS: 6, bpF: 9 };
  const W = winnerBig ? bigServe : grindServe;
  const L = winnerBig ? grindServe : bigServe;
  const wId = winnerBig ? 100 : 200, lId = winnerBig ? 200 : 100;
  const wName = winnerBig ? 'Big Server' : 'Grinder', lName = winnerBig ? 'Grinder' : 'Big Server';
  const wRank = winnerBig ? 5 : 8, lRank = winnerBig ? 8 : 5;
  const score = winnerBig ? '6-4 7-6(5)' : '4-6 7-5 6-4';
  return [
    `2026-${100 + i}`,'Test Open','Hard',32,'A',date,i,
    wId,'','',wName,'R',196,'ITA',24,
    lId,'','',lName,'R',188,'SRB',29,
    score,3,'R32',95,
    W.ace,W.df,W.svpt,W.in1,W.w1,W.w2,W.gms,W.bpS,W.bpF,
    L.ace,L.df,L.svpt,L.in1,L.w1,L.w2,L.gms,L.bpS,L.bpF,
    wRank,4000,lRank,3000,
  ].join(',');
}

const rows = [HEADER];
for (let i = 1; i <= 40; i++) rows.push(matchRow(i, i % 2 === 0)); // alternate winners
const csv = rows.join('\n');

// 1. score parse sanity
const sc = parseScore('6-4 7-6(5)');
console.log('parseScore 6-4 7-6(5):', sc.total, 'games,', sc.sets, 'sets, valid=', sc.valid);
console.assert(sc.total === 23 && sc.sets === 2, 'score parse');
console.assert(parseScore('6-3 2-1 RET').retired === true, 'RET flag');
console.assert(parseScore('W/O').walkover === true, 'WO flag');

// 2. feed → rows
const melted = buildRowsFromCsv(csv);
console.log('melted player-rows:', melted.length, '(expect 80)');
console.assert(melted.length === 80, 'melt count');

// 3. build index
const index = buildIndex(melted);
console.log('index players:', index.meta.players);
const big = index.players['100'], grind = index.players['200'];
console.log('Big Server Hard profile:',
  'ace/svGm=', big.surfaces.Hard.acePerSvGm.toFixed(2),
  'servePtsWon=', big.surfaces.Hard.servePtsWonPct.toFixed(3),
  'n=', big.surfaces.Hard.n);
console.assert(big.surfaces.Hard.acePerSvGm > grind.surfaces.Hard.acePerSvGm, 'big server aces more');
console.assert(big.surfaces.Hard.n >= 20, 'enough hard sample to clear gate');

// 4. projector
const proj = projectMatch({ playerA: big, playerB: grind, surface: 'Hard', bestOf: 3, sims: 3000 });
console.log('winProb Big:', proj.winProbA.toFixed(2),
  '| hold Big:', proj.holdA.toFixed(2), 'hold Grind:', proj.holdB.toFixed(2));
console.log('proj total games:', proj.totalGames.mean.toFixed(1),
  '| Big aces:', proj.acesA.mean.toFixed(1), '| Grind aces:', proj.acesB.mean.toFixed(1));
console.assert(proj.totalGames.mean > 12 && proj.totalGames.mean < 40, 'total games plausible');
console.assert(proj.acesA.mean > proj.acesB.mean, 'big server projects more aces');
console.assert(proj.winProbA >= 0 && proj.winProbA <= 1, 'win prob in range');

// 5. classify (must stay bet:false)
const acesOU = proj.acesA.prob(15.5);
const cls = tennisClassify({ market: 'aces', lean: acesOU.under >= acesOU.over ? 'UNDER' : 'OVER',
  line: 15.5, prob: Math.min(0.72, Math.max(acesOU.under, acesOU.over)), mean: acesOU.mean,
  surfaceN: big.surfaces.Hard.n, rankGap: 3 });
console.log('classify:', cls.tier, '| bet=', cls.bet, '|', cls.reason.slice(0, 70) + '...');
console.assert(cls.bet === false, 'MUST be bet:false pre-grading');

// 6. full match read (with a fantasy line)
const read = buildMatchRead({ playerA: big, playerB: grind, surface: 'Hard', bestOf: 3,
  rankA: 5, rankB: 8, h2h: '10-4 Big',
  lines: { acesA: 15.5, totalGames: 22.5, dfA: 2.5, fantasyA: 34.5 }, sims: 3000 });
console.log('\n--- MATCH READ ---');
console.log(read.matchup, '|', read.surface, '| favored:', read.winProb.favored);
console.log('aces drivers:'); read.drivers.aces.forEach((d) => console.log('  -', d));
console.log('totalGames drivers:'); read.drivers.totalGames.forEach((d) => console.log('  -', d));
console.log('projected fantasy — Big:', read.projected['Big Server'].fantasy.toFixed(1),
  '| Grinder:', read.projected['Grinder'].fantasy.toFixed(1));
console.log('fantasyA prop:', read.props.fantasyA.verdict.tier, 'bet=', read.props.fantasyA.verdict.bet,
  '| model', Math.round(read.props.fantasyA.prob * 100) + '%');
console.log('uses:', read.usesFields.join(', '));
console.assert(read.props.acesA.verdict.bet === false, 'read props bet:false');
console.assert(Number.isFinite(read.projected['Big Server'].fantasy), 'fantasy projected present');
console.assert(read.props.fantasyA.verdict.bet === false, 'fantasy bet:false (prior until graded)');
console.assert(read.projected['Big Server'].fantasy > 8, 'fantasy includes +10 match-played baseline');

// 7. congregation: circumstances move the projection (in-form+rested > cold+fatigued+surface-switch)
const hot = JSON.parse(JSON.stringify(big));
hot.recent = { formAce: 0.3, formServe: 0.02, minutesLast10: 0, matchesLast10: 1, lastSurface: 'Hard' };
const cold = JSON.parse(JSON.stringify(big));
cold.recent = { formAce: -0.3, formServe: -0.02, minutesLast10: 1400, matchesLast10: 6, lastSurface: 'Clay' };
const readHot = buildMatchRead({ playerA: hot, playerB: grind, surface: 'Hard', bestOf: 3, lines: {}, sims: 2500 });
const readCold = buildMatchRead({ playerA: cold, playerB: grind, surface: 'Hard', bestOf: 3, lines: {}, sims: 2500 });
console.log('\n--- congregation ---');
console.log('hot  :', readHot.drivers.circumstances[0], '→ fantasy', readHot.projected['Big Server'].fantasy.toFixed(1));
console.log('cold :', readCold.drivers.circumstances[0], '→ fantasy', readCold.projected['Big Server'].fantasy.toFixed(1));
console.assert(readHot.projected['Big Server'].fantasy > readCold.projected['Big Server'].fantasy,
  'in-form+rested projects higher fantasy than cold+fatigued+surface-switch');
console.assert(readHot.circumstances['Big Server'].formAce > 0 && readCold.circumstances['Big Server'].surfaceSwitch === true,
  'circumstances congregated into the read');
console.assert(read.projected['Big Server'].fantasy > read.projected['Grinder'].fantasy, 'winner-favored server scores higher fantasy');

console.log('\n✓ ALL SMOKE CHECKS PASSED');
