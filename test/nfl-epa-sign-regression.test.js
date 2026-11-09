import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNflProV1, NFL_PRO_VERSION} from '../functions/lib/nflProModel.js';
import {projectNflProV2} from '../functions/lib/nflProV2Model.js';
import {replayNflProScore} from '../functions/lib/nflScoreReplayAudit.js';
import {NFL_DISPLAYED_RESEARCH, NFL_PRODUCTION_CHAMPION} from '../functions/lib/nflModelGovernance.js';

const features = () => ({offenseEpa:0,defenseEpa:0,qbEpa:0,passEpa:0,rushEpa:0,passEpaAllowed:0,rushEpaAllowed:0});
const fixture = () => ({neutralSite:true,nflFeatures:{home:features(),away:features()}});
for(const model of [projectNflProV1,projectNflProV2]){
 for(const side of ['home','away']){
  const opponent = side==='home'?'away':'home';
  for(const field of ['passEpaAllowed','rushEpaAllowed']){
   test(`${model.name}: lower ${opponent} ${field} never raises ${side} score`,()=>{
    let previous=-Infinity;
    for(const allowed of [-2,-.4,-.2,-.1,0,.1,.2,.4,2]){
     const game=fixture();game.nflFeatures[opponent][field]=allowed;
     const result=model(game);
     assert.equal(result.ok,true);
     assert.ok(result[side]>=previous,`${field}=${allowed}`);
     previous=result[side];
     assert.equal(result[opponent],22.5);
     assert.equal(result.canAuthorizeWager,false);
    }
   });
  }
 }
}
test('v1.2.1 reverses the reproduced defensive EPA regression and replays exactly',()=>{
 const good=fixture(),bad=fixture();
 for(const field of ['passEpaAllowed','rushEpaAllowed']){
  good.nflFeatures.away[field]=-.2;bad.nflFeatures.away[field]=.2;
 }
 const g=projectNflProV1(good),b=projectNflProV1(bad);
 assert.equal(g.home,20.2);assert.equal(b.home,24.8);
 assert.ok(Math.abs(g.decomposition.home.matchup.pass+1.4)<1e-12);
 assert.equal(g.decomposition.home.matchup.rush,-.9);
 assert.equal(replayNflProScore(g).reconciled,true);
 assert.equal(g.version,NFL_PRO_VERSION);
 assert.equal(g.provenance.calibrationStatus,'unvalidated-sign-correction');
 assert.equal(NFL_DISPLAYED_RESEARCH.version,NFL_PRO_VERSION);
 assert.equal(NFL_PRODUCTION_CHAMPION.version,'v1.1');
});
test('missing EPA remains missing; market prices do not affect corrected score',()=>{
 const game=fixture();delete game.nflFeatures.away.passEpaAllowed;
 const p=projectNflProV1(game);
 assert.equal(p.decomposition.home.matchup.pass,null);
 assert.deepEqual(projectNflProV1({...game,market:{spread:-20,total:70}}),p);
 assert.equal(projectNflProV1({}).version,NFL_PRO_VERSION);
 assert.equal(projectNflProV1({}).ok,false);
});
test('offensive EPA improvement remains monotonic after correction',()=>{
 for(const key of ['passEpa','rushEpa']){
  const low=fixture(),high=fixture();low.nflFeatures.home[key]=-.2;high.nflFeatures.home[key]=.2;
  assert.ok(projectNflProV1(high).home>projectNflProV1(low).home);
 }
});

const fullFixture=()=>{
 const g=fixture();
 // Test-only references, not fitted production constants.
 g.nflLeagueBaselines={explosiveRate:.1,pressureRate:.25,lineYards:4};
 for(const f of Object.values(g.nflFeatures))Object.assign(f,{explosiveRate:.1,explosiveRateAllowed:.1,pressureRate:.25,pressureRateAllowed:.25,lineYards:4,lineYardsAllowed:4});
 return g;
};
for(const model of [projectNflProV1,projectNflProV2]){
 for(const side of ['home','away']){
  const opp=side==='home'?'away':'home';
  for(const [field,owner,values,direction] of [
   ['explosiveRate',side,[.05,.1,.15],1],
   ['explosiveRateAllowed',opp,[.05,.1,.15],1],
   ['lineYards',side,[3,4,5],1],
   ['lineYardsAllowed',opp,[3,4,5],1],
   ['pressureRateAllowed',side,[.1,.25,.4],-1],
   ['pressureRate',opp,[.1,.25,.4],-1],
  ]){
   test(`${model.name} ${side} score direction: ${owner} ${field}`,()=>{
    const scores=values.map(v=>{const g=fullFixture();g.nflFeatures[owner][field]=v;return model(g)[side];});
    assert.ok((scores[1]-scores[0])*direction>0);
    assert.ok((scores[2]-scores[1])*direction>0);
   });
  }
 }
}
test('nonzero-baseline terms are neutral at explicit league references and fail closed without them',()=>{
 const g=fullFixture(),p=projectNflProV1(g);
 for(const k of ['explosive','pressure','trenches'])assert.equal(p.decomposition.home.matchup[k],0);
 delete g.nflLeagueBaselines;
 const missing=projectNflProV1(g);
 for(const k of ['explosive','pressure','trenches'])assert.equal(missing.decomposition.home.matchup[k],null);
 assert.equal(projectNflProV2(g).interactions.home.pressure,null);
 assert.ok(missing.coverage.share<p.coverage.share);
});
test('team defensive EPA, success allowed and early-down allowed retain the correct margin direction',()=>{
 for(const key of ['defenseEpa','successRateAllowed','earlyDownEpaAllowed']){
  const stronger=fixture(),weaker=fixture();
  stronger.nflFeatures.home[key]=key==='successRateAllowed'?.3:-.1;
  weaker.nflFeatures.home[key]=key==='successRateAllowed'?.5:.1;
  assert.ok(projectNflProV1(stronger).margin>projectNflProV1(weaker).margin);
 }
});
