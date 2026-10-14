import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/tennis-player-profile.js';
const req=id=>new Request(`https://example.test/api/tennis-player-profile?id=${encodeURIComponent(id)}`);
const player={fbis_player_id:'tennis:wta:1',tour:'wta',canonical_name:'Player <script>alert(1)</script>',normalized_name:'player one',country_code:'RUS',current_rank:6,ranking_points:0,official_source:'WTA_OFFICIAL',official_effective_at:'2026-10-12'};
function db(found=player){return {prepare(sql){return {bind(...args){assert.ok(args.length);return {async first(){return found},async all(){return {results:sql.includes('profiles')?[{surface:'grass',profile_json:JSON.stringify({surfaceMatches:0,servePointWin:.6}),source_as_of:'2026-10-07',last_match_date:'2026-05-25',source:'TEST_SOURCE',source_license:'TEST_LICENSE'}]:[]}}}}}}}};
test('permanent canonical profiles escape source text, retain real zeros/timestamps, and do not invent no-sample rates or portraits',async()=>{
 const r=await onRequestGet({request:req(player.fbis_player_id),env:{DB:db()}}),html=await r.text();assert.equal(r.status,200);assert.match(html,/Player &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Individual neutral athlete/);assert.match(html,/Ranking points<\/dt><dd>0/);assert.match(html,/No sample/);assert.doesNotMatch(html,/60.0%|<img/);assert.match(html,/2026-10-07/);assert.match(html,/2026-05-25/);assert.match(html,/No wagering authorization/);assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
});
test('unknown or malformed canonical IDs and missing databases fail closed',async()=>{
 assert.equal((await onRequestGet({request:req('<bad>'),env:{DB:db()}})).status,400);
 assert.equal((await onRequestGet({request:req('tennis:wta:1'),env:{}})).status,503);
 assert.equal((await onRequestGet({request:req('tennis:wta:999'),env:{DB:db(null)}})).status,404);
});
