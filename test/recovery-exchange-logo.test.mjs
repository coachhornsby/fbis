import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const component = readFileSync('src/components/board/RecoveryMiniGameCard.jsx', 'utf8');
const css = readFileSync('src/components/board/recoveryMiniGameCard.css', 'utf8');
const asset = readFileSync('public/brands/polymarket.png');

test('Polymarket exchange card uses the bundled owner-provided logo', () => {
  assert.ok(css.includes("/brands/polymarket-watermark.png"));
  assert.ok(!component.includes('polymarket.com/images/brand/icon-blue.png'));
  assert.ok(component.includes("aria-label={venue+' reference prices'}"));
  assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(asset.readUInt32BE(16), 96);
  assert.equal(asset.readUInt32BE(20), 96);
});

test('Kalshi and all exchange price rows are unaffected', () => {
  assert.ok(component.includes("['Kalshi','Polymarket'].map(venue=>"));
  assert.ok(component.includes('exchangeCardRows(game,clock)'));
  assert.ok(component.includes('row.cells.map((cell,i)=>'));
  assert.ok(component.includes('className="fbis-mini-venue-watermark"'));
});

test('exchange table labels away and home columns with actual TeamLogo images', () => {
  assert.equal((component.match(/className="fbis-mini-market-team-logo"/g) || []).length, 2);
  assert.ok(component.includes('<TeamLogo team={away} size={30} tone="light" className="fbis-mini-market-team-logo"/>'));
  assert.ok(component.includes('<TeamLogo team={home} size={30} tone="light" className="fbis-mini-market-team-logo"/>'));
  assert.ok(component.includes('aria-label={displayName(away)}'));
  assert.ok(component.includes('aria-label={displayName(home)}'));
  const logoComponent = readFileSync('src/components/TeamLogo.jsx', 'utf8');
  assert.ok(logoComponent.includes('team-logo-fallback'));
  assert.ok(logoComponent.includes('onError={() => setFailed(true)}'));
});

test('projected score section shows team names without duplicate abbreviations', () => {
  assert.ok(component.includes('<strong title={displayName(away)}>{displayName(away)}</strong>'));
  assert.ok(component.includes('<strong title={displayName(home)}>{displayName(home)}</strong>'));
  assert.ok(!component.includes('smallName('));
  assert.ok(!component.includes('<span>{smallName(away)}</span>'));
  assert.ok(!component.includes('<span>{smallName(home)}</span>'));
});

test('both supplied venue watermarks are bundled PNG assets',()=>{for(const name of ['kalshi-watermark','polymarket-watermark']){const bytes=readFileSync('public/brands/'+name+'.png');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(css.includes('/brands/'+name+'.png'));}assert.ok(css.includes('@media(forced-colors:active)'));assert.ok(component.includes('{venue}</span>'));});
