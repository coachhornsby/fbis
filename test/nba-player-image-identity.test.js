import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/player-image.js';

const FOX_PHOTO = 'https://a.espncdn.com/i/headshots/nba/players/full/4066259.png';
const ROSTER = { athletes: [{id:'4066259',displayName:"De'Aaron Fox",
  position:{abbreviation:'G'},headshot:{href:FOX_PHOTO}}] };

test('Fox exchange team SAS returns official Spurs portrait before any fallback', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      assert.match(String(url),/\/basketball\/nba\/teams\/24\/roster$/);
      return {ok:true,json:async()=>ROSTER};
    };
    const res=await onRequestGet({
      request:new Request("https://fbis.test/api/player-image?name=De%27Aaron%20Fox&sport=nba&team=SAS&mode=json"),
      env:{},
    });
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.found,true);
    assert.equal(body.source,'ESPN_ROSTER');
    assert.equal(body.team,'SA');
    assert.equal(body.playerId,'espn:nba:4066259');
    assert.equal(body.imageUrl,FOX_PHOTO);
    assert.equal(calls.length,1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unknown Spurs player never drops through to old Wikimedia portraits', async () => {
  const originalFetch=globalThis.fetch;
  const calls=[];
  try {
    globalThis.fetch=async url=>{
      calls.push(String(url));
      return {ok:true,json:async()=>ROSTER};
    };
    const db={prepare:()=>({bind:()=>({first:async()=>null})})};
    const res=await onRequestGet({
      request:new Request("https://fbis.test/api/player-image?name=Unknown%20Athlete&sport=nba&team=SAS&mode=json"),
      env:{DB:db},
    });
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.found,false);
    assert.equal(body.reason,'team-roster-portrait-unavailable');
    assert.ok(calls.every(url=>url.includes('/basketball/nba/teams/24/roster')));
    const imageRes=await onRequestGet({
      request:new Request("https://fbis.test/api/player-image?name=Unknown%20Athlete&sport=nba&team=SAS&mode=image"),
      env:{DB:db},
    });
    assert.equal(imageRes.status,404);
    assert.equal(imageRes.headers.get('cache-control'),'no-store');
  } finally {globalThis.fetch=originalFetch;}
});
