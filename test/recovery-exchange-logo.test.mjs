import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const component = readFileSync('src/components/board/RecoveryMiniGameCard.jsx', 'utf8');
const asset = readFileSync('public/brands/polymarket.png');

test('Polymarket exchange card uses the bundled owner-provided logo', () => {
  assert.ok(component.includes("'/brands/polymarket.png'"));
  assert.ok(!component.includes('polymarket.com/images/brand/icon-blue.png'));
  assert.ok(component.includes('alt={row.venue}'));
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(asset.readUInt32BE(16), 96);
  assert.equal(asset.readUInt32BE(20), 96);
});

test('Kalshi and all exchange price rows are unaffected', () => {
  assert.ok(component.includes("row.venue==='Kalshi'?'https://kalshi.com/favicon.ico'"));
  assert.ok(component.includes('exchangeCardRows(game,clock)'));
  assert.ok(component.includes('row.cells.map((cell,i)=>'));
  assert.ok(component.includes('className="fbis-mini-exchange-logo"'));
});
