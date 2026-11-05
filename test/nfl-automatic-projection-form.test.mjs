import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSeasonScoringForm} from '../functions/lib/verifiedSeasonScoringForm.js';
import {projectNflFormV0,NFL_SHADOW_ID} from '../functions/lib/nflModel.js';
const finals=Array.from({length:5},(_,n)=>({
 homeId:'1',awayId:'2',homePoints:24+n,awayPoints:17+n,
 start:new Date(Date.parse('2026-09-15T01:00:00Z')+n*7*86400000).toISOString()
}));
test('shared verified scoring form uses NFL expected keys without losing CFB pf/pa keys',()=>{
 const h=verifiedSeasonScoringForm(finals,'1'),a=verifiedSeasonScoringForm(finals,'2');
 assert.equal(h.games,5);assert.equal(h.pf,130);assert.equal(h.pointsFor,h.pf);
 assert.equal(h.pa,95);assert.equal(h.pointsAgainst,h.pa);
 assert.equal(a.pointsFor,95);assert.equal(a.pointsAgainst,130);
});
test('the NFL model accepts actual validated current-season scoring totals, no fabricated prior',()=>{
 const projection=projectNflFormV0({sport:'nfl',neutralSite:false},{
   homeCurrent:verifiedSeasonScoringForm(finals,'1'),
   awayCurrent:verifiedSeasonScoringForm(finals,'2')
 });
 assert.equal(projection.ok,true);
 assert.equal(projection.modelId,NFL_SHADOW_ID);
 assert.equal(projection.canQualify,false);
 assert.equal(projection.marketInformed,false);
 assert.ok(Number.isFinite(projection.home)&&Number.isFinite(projection.away));
 assert.ok(Math.abs(projection.total-projection.home-projection.away)<0.2);
});
test('missing and corrupt form evidence cannot create NFL scores',()=>{
 assert.equal(verifiedSeasonScoringForm(finals,'3'),null);
 assert.equal(verifiedSeasonScoringForm([{...finals[0],homePoints:NaN}],'1'),null);
 assert.equal(projectNflFormV0({},{
   homeCurrent:verifiedSeasonScoringForm(finals,'3'),
   awayCurrent:verifiedSeasonScoringForm(finals,'2')
 }).ok,false);
});
