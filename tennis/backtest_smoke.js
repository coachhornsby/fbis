// backtest_smoke.js — verify the edge-discovery harness detects a PLANTED signal and not a null one.
import { buildRowsFromCsv } from './tennisFeed.js';
import { backtest } from './tennisBacktest.js';

const HEADER = ['tourney_id','tourney_name','surface','draw_size','tourney_level','tourney_date','match_num','winner_id','winner_seed','winner_entry','winner_name','winner_hand','winner_ht','winner_ioc','winner_age','loser_id','loser_seed','loser_entry','loser_name','loser_hand','loser_ht','loser_ioc','loser_age','score','best_of','round','minutes','w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced','l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced','winner_rank','winner_rank_points','loser_rank','loser_rank_points'].join(',');

const noise = (n) => Math.round((Math.random() - 0.5) * 2 * n);
// PLANT: player 100 serves ~12 aces on Hard, ~4 on Clay (suppression). DF ~3 both (null signal).
function line(surface, isP100) {
  const aces = isP100 ? (surface === 'Clay' ? 4 : 12) + noise(2) : 6 + noise(2);
  return { ace: Math.max(0, aces), df: 3 + noise(1), svpt: 72, in1: 44, w1: 34, w2: 15, gms: 12, bpS: 4, bpF: 6 };
}
function row(i) {
  const surface = i % 2 === 0 ? 'Hard' : 'Clay';
  const year = i < 200 ? 2022 : 2024;                     // <200 → train, ≥200 → test
  const date = `${year}${String((i % 12) + 1).padStart(2, '0')}15`;
  const p100win = i % 3 !== 0;                            // 100 wins ~2/3
  const W = line(surface, p100win), L = line(surface, !p100win);
  const wId = p100win ? 100 : 200 + (i % 5), lId = p100win ? 200 + (i % 5) : 100;
  const wN = p100win ? 'Server' : 'Opp' + (i % 5), lN = p100win ? 'Opp' + (i % 5) : 'Server';
  return [`t${i}`,'T',surface,32,'A',date,i,wId,'','',wN,'R',190,'ITA',25,lId,'','',lN,'R',188,'SRB',26,
    '6-4 6-4',3,'R32',90,W.ace,W.df,W.svpt,W.in1,W.w1,W.w2,W.gms,W.bpS,W.bpF,
    L.ace,L.df,L.svpt,L.in1,L.w1,L.w2,L.gms,L.bpS,L.bpF,5,4000,40,1200].join(',');
}

const rows = [HEADER];
for (let i = 1; i <= 400; i++) rows.push(row(i));
const melted = buildRowsFromCsv(rows.join('\n'));
const train = melted.filter((r) => r.date < '2024-01-01');
const test = melted.filter((r) => r.date >= '2024-01-01');
console.log(`train ${train.length} · test ${test.length} player-rows`);

const results = backtest(train, test);
console.log('\nSIGNAL' + ' '.repeat(44) + 'n     hit%   lift    edge?');
for (const r of results) {
  const lift = r.lift == null ? '  —' : ((r.lift >= 0 ? '+' : '') + (r.lift * 100).toFixed(1)).padStart(6);
  console.log(`${r.name.padEnd(48)} ${String(r.n).padStart(5)}  ${r.rate == null ? '  —' : (r.rate * 100).toFixed(1).padStart(5)}  ${lift}   ${r.edge ? 'YES ✅' : ''}`);
}

const clay = results.find((r) => r.name === 'Aces UNDER — clay');
const dfBase = results.find((r) => r.name === 'Double faults UNDER — baseline');
console.log('\n--- assertions ---');
console.assert(clay && clay.n >= 30, 'clay signal has enough n');
console.assert(clay && clay.lift > 0.05, `planted clay edge shows real LIFT over base (got ${clay ? (clay.lift * 100).toFixed(1) : '?'}pp)`);
console.assert(clay && clay.edge === true, 'clay flagged as real edge');
console.assert(dfBase && Math.abs(dfBase.lift) < 0.001, 'a base-rate signal has ~0 lift vs itself (no false edge)');
console.assert(dfBase && dfBase.edge === false, 'null/base signal NOT flagged as edge');
console.log('✓ harness detects planted edge by lift, ignores line-placement base');
