import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNbaDeepFeatures} from '../functions/lib/nbaDeepFeatures.js';
const history=[{date:'2026-11-01T00:00:00Z',pointsFor:110,pointsAgainst:108,possessions:100}];
function features(home,away){
  return buildNbaDeepFeatures({id:'test',start:'2026-11-08T23:00:00Z'}, {
    homeHistory:history,awayHistory:history,
    homeLineup:{availabilityVerified:home},awayLineup:{availabilityVerified:away}
  });
}
for (const [home,away,expected] of [[false,false,false],[true,false,false],[false,true,false],[true,true,true]]) {
  test(`game availability requires both teams: ${home}/${away}`,()=>{
    const result=features(home,away);
    assert.equal(result.ok,true);
    assert.equal(result.provenance.availabilityVerified,expected);
  });
}
test('verification labels do not alter features or forecasts',()=>{
  const missing=features(false,false),verified=features(true,true);
  assert.deepEqual(missing.vector,verified.vector);
  assert.deepEqual(missing.incumbent,verified.incumbent);
});
