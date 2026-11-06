import test from 'node:test';
import assert from 'node:assert/strict';
import {publicProjectionSummary,validatePublicProjectionSummary} from '../functions/lib/publicFourSportProjection.js';
import {onRequestGet} from '../deploy/board/functions/api/public/sports/[sport]/[date].js';

const date='2099-11-07';
const generatedAt='2099-11-07T12:00:00Z';
const expiresAt='2099-11-08T06:00:00Z';
const event={eventId:'401234567',date,start:'2099-11-08T01:00:00Z',homeId:'cfb-1',awayId:'cfb-2',
  sourceCapturedAt:'2099-11-07T11:55:00Z',canAuthorizeWager:false,
  sourceLabel:'ESPN verified 2026 team scoring form',
  projection:{homeScore:27.5,awayScore:20.5,margin:7,total:48,
    modelId:'CFB-SCORE-FORM-RESEARCH',modelVersion:'v1.3-score-form'}};
const privatePacket={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'cfb',date,generatedAt,
  expiresAt,modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,
  internalOnly:{secret:'MUST_NOT_LEAK'},events:[{...event,providerRaw:{secret:'MUST_NOT_LEAK'}}]};
const req=new Request('https://fbis-myz.pages.dev/api/public/sports/cfb/'+date);

test('owner-model public packet is a strict minimal, non-wager summary',()=>{
  const packet=publicProjectionSummary(privatePacket,{sport:'cfb',date});
  validatePublicProjectionSummary(packet,{sport:'cfb',date});
  assert.equal(packet.visibility,'PUBLIC_MODEL_SUMMARY');
  assert.equal(packet.events[0].projection.homeScore,27.5);
  assert.equal(packet.canAuthorizeWager,false);
  assert.equal(packet.canQualify,false);
  assert.equal(JSON.stringify(packet).includes('MUST_NOT_LEAK'),false);
  assert.equal(JSON.stringify(packet).includes('sourceLabel'),false);
});
test('private provider-derived or unapproved CFB model never leaks',()=>{
  const changed={...privatePacket,events:[{...event,projection:{...event.projection,modelId:'CBB-KENPOM-RATINGS-v1'}}]};
  assert.equal(publicProjectionSummary(changed,{sport:'cfb',date}).events.length,0);
  const unverified={...privatePacket,events:[{...event,sourceLabel:'KenPom licensed ratings'}]};
  assert.equal(publicProjectionSummary(unverified,{sport:'cfb',date}).events.length,0);
  assert.throws(()=>publicProjectionSummary(privatePacket,{sport:'cbb',date}),/PUBLIC_SPORT_NOT_ALLOWED/);
});
test('anonymous GET returns cleared model score without cookies, tokens, markets or D1',async()=>{
  let reads=0;
  const env={FBIS_PRIVATE_CBB:{get:async key=>{
    reads++;assert.equal(key,'private/cfb/projections/'+date+'.json');
    const body=JSON.stringify(privatePacket);
    return {size:body.length,text:async()=>body};
  }}};
  const res=await onRequestGet({request:req,params:{sport:'cfb',date},env});
  assert.equal(res.status,200);assert.equal(reads,1);
  const body=await res.json();
  assert.equal(body.state,'PUBLIC_RESEARCH_ONLY');
  assert.equal(body.packet.events.length,1);
  assert.equal(body.packet.events[0].projection.total,48);
  assert.equal(JSON.stringify(body).includes('MUST_NOT_LEAK'),false);
  assert.equal(JSON.stringify(body).includes('market'),true); // false-only availability flag
  assert.equal(body.packet.marketQuotesAvailable,false);
});
test('CBB route blocked before private storage read',async()=>{
  let reads=0;
  const r=await onRequestGet({request:req,params:{sport:'cbb',date},env:{FBIS_PRIVATE_CBB:{get:async()=>{reads++;}}}});
  assert.equal(r.status,400);assert.equal(reads,0);
});
test('expired packet returns 404, never a current model projection',async()=>{
  const old={...privatePacket,generatedAt:'2026-11-01T12:00:00Z',expiresAt:'2026-11-02T06:00:00Z',
    events:[{...event,sourceCapturedAt:'2026-11-01T11:55:00Z',start:'2026-11-01T20:00:00Z'}]};
  const body=JSON.stringify(old);
  const res=await onRequestGet({request:req,params:{sport:'cfb',date},env:{FBIS_PRIVATE_CBB:{get:async()=>({size:body.length,text:async()=>body})}}});
  assert.notEqual(res.status,200);
});
test('anonymous validator refuses substituted model authority',()=>{
  const p=publicProjectionSummary(privatePacket,{sport:'cfb',date});
  p.events[0].projection.modelId='OTHER';
  assert.throws(()=>validatePublicProjectionSummary(p,{sport:'cfb',date}),/NON_PUBLIC_MODEL/);
});
