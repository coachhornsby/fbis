import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sharpRowsToEvents } from '../functions/lib/sharpApi.js';
import { adaptObservation } from '../research/situational/marketEvidence.mjs';

// Synthetic contract counterexamples, NOT acquired offers or source qualification.
function fixture(clockSemantics) {
  const body={providerEventId:'p',sport:'NFL',league:'NFL',homeProviderId:'h',awayProviderId:'a',selectedProviderTeamId:'a',side:'AWAY',market:'FULL_GAME_SPREAD',period:'FULL_GAME',book:'DraftKings',price:-110,line:3.5,observedAt:'2027-09-01T11:59:00Z'};
  const rawBody=JSON.stringify(body),kickoff='2027-09-01T20:00:00Z';
  const record={...body,observationId:'o',eventId:'e',homeId:'H',awayId:'A',selectedTeamId:'A',kickoff,source:'sharpapi',acquiredAt:'2027-09-01T11:59:01Z',sourceRef:'r2://research/counterexample.json',payloadHash:createHash('sha256').update(rawBody).digest('hex'),signConvention:'SELECTED_TEAM_SIGNED'};
  const context={decisionAt:'2027-09-01T12:00:00Z',rawBody,event:{id:'e',providerEventId:'p',sport:'NFL',league:'NFL',homeId:'H',awayId:'A',homeProviderId:'h',awayProviderId:'a',kickoff,verified:true,availableAt:'2027-08-01T00:00:00Z',provenanceRef:'r2://research/identity.json'},policy:{source:'sharpapi',version:'synthetic-v1',maxAgeSeconds:600,bookmakers:['DraftKings'],provenanceRef:'r2://research/policy.json'},mapping:{source:'sharpapi',verified:true,availableAt:'2027-08-01T00:00:00Z',provenanceRef:'r2://research/semantics.json',clockSemantics,signConvention:'SELECTED_TEAM_SIGNED',fields:Object.fromEntries(Object.keys(body).map(k=>[k,k]))}};
  return {record,context};
}

test('feed-refresh and receipt clocks cannot pass the existing original-observation gate',()=>{
  const control=fixture('PROVIDER_ORIGINAL');assert.notEqual(adaptObservation(control.record,control.context).quote,null);
  for(const semantic of ['PROVIDER_FEED_REFRESH','ACQUISITION','UNKNOWN']){
    const f=fixture(semantic),r=adaptObservation(f.record,f.context);
    assert.equal(r.quote,null);assert.ok(r.reasons.some(x=>x.code==='UNVERIFIED_SCHEMA_OR_SPREAD_CONVENTION'));
    assert.equal(r.authority.canAuthorizeWager,false);
  }
});

test('parseable SharpAPI display rows are not a source-preserving native capture',()=>{
  const native={id:'q',event_id:'p',home_team:'Dallas Cowboys',away_team:'Tampa Bay Buccaneers',sportsbook:'draftkings',market_type:'point_spread',selection:'Tampa Bay Buccaneers',selection_type:'away',line:3.5,odds_american:-110,event_start_time:'2027-09-01T20:00:00Z',timestamp:'2027-09-01T11:59:00Z',is_active:false,is_live:false};
  const ev=sharpRowsToEvents([native],'nfl')[0];
  assert.equal(ev.bookmakers[0].markets[0].outcomes[0].price,-110);
  assert.equal(ev.bookmakers[0].markets[0].outcomes[0].point,3.5);
  assert.equal(JSON.stringify(ev).includes('timestamp'),false);
  assert.equal(JSON.stringify(ev).includes('is_active'),false);
  // Missing original clock fails even when every other synthetic mapping is valid.
  const f=fixture('PROVIDER_ORIGINAL');f.record.observedAt=null;
  const r=adaptObservation(f.record,f.context);assert.equal(r.quote,null);
  assert.ok(r.reasons.some(x=>x.code==='MISSING_PROVIDER_TIMESTAMP'));
});
