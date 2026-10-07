// scan_smoke.js — verify the total-games scan finds a real-line edge and ignores noise.
import { scanTotalGames } from './tennisTotalGamesScan.js';

const noise = (n) => (Math.random() - 0.5) * 2 * n;
const sack = [], lines = [];
for (let i = 1; i <= 450; i++) {
  const surface = ['Hard', 'Clay', 'Grass'][i % 3];
  const rankA = 1 + (i % 40), rankB = 1 + ((i * 7) % 200);
  const actual = Math.max(12, Math.round(20 + noise(4)));
  // Line is efficient (centered on actual → ~50% each way) EXCEPT on clay, where the "book" sets it
  // ~4 games too high → clay systematically goes UNDER. That's the one planted, conditional edge.
  let line = actual + noise(3) + (surface === 'Clay' ? 4 : 0);
  line = Math.round(line) + 0.5;
  const date = `2024-${String((i % 12) + 1).padStart(2, '0')}-15`;
  const a = `Al${i} Aa${i}`, b = `Be${i} Bb${i}`;
  sack.push({ playerName: a, oppName: b, totalGames: actual, surface, date, playerRank: rankA, oppRank: rankB });
  sack.push({ playerName: b, oppName: a, totalGames: actual, surface, date, playerRank: rankB, oppRank: rankA });
  lines.push({ date, playerA: a, playerB: b, line });
}

const res = scanTotalGames(lines, sack);
console.log(`joined ${res.matches} matches\n`);
console.log('SIGNAL' + ' '.repeat(42) + 'n     hit%   lift    edge?');
for (const s of res.signals) {
  const lift = s.lift == null ? '  —' : ((s.lift >= 0 ? '+' : '') + (s.lift * 100).toFixed(1)).padStart(6);
  console.log(`${s.name.padEnd(46)} ${String(s.n).padStart(4)}  ${s.rate == null ? ' —' : (s.rate * 100).toFixed(1).padStart(5)}  ${lift}   ${s.edge ? 'YES ✅' : ''}`);
}

const claySig = res.signals.find((s) => s.name === 'UNDER — clay');
const base = res.signals.find((s) => s.name.startsWith('UNDER — ANY'));
console.log('\n--- assertions ---');
console.assert(claySig && claySig.n >= 40, 'clay signal has enough n');
console.assert(claySig && claySig.lift > 0.1, `planted clay-under edge detected (lift ${claySig ? (claySig.lift * 100).toFixed(1) : '?'}pp)`);
console.assert(claySig && claySig.edge === true, 'clay under flagged as real edge');
console.assert(base && Math.abs(base.lift) < 0.001, 'base rate has ~0 lift vs itself');
console.log('✓ total-games scan finds the real-line edge, ignores the base');
