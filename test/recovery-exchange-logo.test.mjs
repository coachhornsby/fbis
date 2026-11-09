import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const component = readFileSync('src/components/board/RecoveryMiniGameCard.jsx', 'utf8');
const comparison = readFileSync('src/components/board/MarketComparisonGrid.jsx', 'utf8');
const css = readFileSync('src/components/board/marketComparisonGrid.css', 'utf8');
const asset = readFileSync('public/brands/polymarket.png');

test('Polymarket exchange card uses the bundled owner-provided logo', () => {
  assert.ok(css.includes("/brands/polymarket-watermark.png"));
  assert.ok(!component.includes('polymarket.com/images/brand/icon-blue.png'));
  assert.ok(comparison.includes('Captured market comparison'));
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(asset.readUInt32BE(16), 96);
  assert.equal(asset.readUInt32BE(20), 96);
});

test('all sources share the comparison while original quote adapters remain in use',()=>{
 assert.ok(comparison.includes("const venues=['Pinnacle','Kalshi','Polymarket']"));
 assert.ok(component.includes('exchangeCardRows(game,clock)'));
 assert.ok(component.includes('pinnoddsCardRows(game,clock)'));
 assert.ok(component.includes('rows={[...pinnacleRows,...exchangeRows]}'));
});
test('team rows retain actual names and accessible TeamLogo fallbacks',()=>{
 assert.ok(comparison.includes('team={game[side]} size={68}'));
 assert.ok(comparison.includes("aria-label={name(game[side])+' · '+side}"));assert.ok(!comparison.includes('<span>{name(game[side])}</span>'));
 const logo=readFileSync('src/components/TeamLogo.jsx','utf8');
 assert.ok(logo.includes('team-logo-fallback'));assert.ok(logo.includes('onError={() => setFailed(true)}'));
});

test('projected score section shows team names without duplicate abbreviations', () => {
  assert.ok(component.includes('<strong title={displayName(away)}>{displayName(away)}</strong>'));
  assert.ok(component.includes('<strong title={displayName(home)}>{displayName(home)}</strong>'));
  assert.ok(!component.includes('smallName('));
  assert.ok(!component.includes('<span>{smallName(away)}</span>'));
  assert.ok(!component.includes('<span>{smallName(home)}</span>'));
});

test('both supplied venue watermarks are bundled PNG assets',()=>{for(const name of ['kalshi-watermark','polymarket-watermark']){const bytes=readFileSync('public/brands/'+name+'.png');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(css.includes('/brands/'+name+'.png'));}assert.ok(css.includes('@media(forced-colors:active)'));assert.ok(comparison.includes('{venue}</span>'));});
