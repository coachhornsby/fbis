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

test('canonical ATP/WTA profile displays its own saved feed image when no licensed R2 image exists',async()=>{
 const athlete={...player,fbis_player_id:'tennis:atp:41',tour:'atp',canonical_name:'Example ATP Player',normalized_name:'example atp player',official_headshot_url:'https://static.prizepicks.com/images/manual/example.png',official_headshot_source:'PRIZEPICKS_FEED'};
 const DB={prepare(sql){return{bind(...args){return{
  async first(){return sql.includes('FROM tennis_players')?athlete:null},
  async all(){if(sql.includes('FROM tennis_players WHERE fbis_player_id IN'))return{results:[athlete]};
   return{results:[]}}
 }}}}};
 const response=await onRequestGet({request:req(athlete.fbis_player_id),env:{DB}});
 const html=await response.text();
 assert.equal(response.status,200);
 assert.match(html,/Example ATP Player feed player portrait/);
 assert.match(html,/https:\/\/static.prizepicks.com\/images\/manual\/example.png/);
 assert.match(html,/Stored on canonical player profile/);
 assert.match(response.headers.get('content-security-policy'),/img-src 'self' https:\/\/static.prizepicks.com/);
 assert.doesNotMatch(html,/approved player portrait/);
});

test('player page refuses wrong-player or invalid feed images, preserving silhouette fallback',async()=>{
 const athlete={...player,fbis_player_id:'tennis:atp:41',tour:'atp',canonical_name:'Example ATP Player'};
 const DB={prepare(sql){return{bind(){return{
  async first(){return sql.includes('FROM tennis_players')?athlete:null},
  async all(){if(sql.includes('FROM tennis_players WHERE fbis_player_id IN'))
    return{results:[{fbis_player_id:'tennis:atp:other',official_headshot_url:'https://static.prizepicks.com/wrong.png',official_headshot_source:'PRIZEPICKS_FEED'}]};
    return{results:[]};}
 }}}}};
 const html=await (await onRequestGet({request:req(athlete.fbis_player_id),env:{DB}})).text();
 assert.match(html,/Player portrait unavailable/);
 assert.doesNotMatch(html,/<img/);
});

test('all player profile headshots fill a defined frame with cover positioning',async()=>{
 const athlete={...player,fbis_player_id:'tennis:wta:320228',tour:'wta',canonical_name:'Rebecca Sramkova',
   official_headshot_url:'https://static.prizepicks.com/player/rebecca.png',official_headshot_source:'PRIZEPICKS_FEED'};
 const DB={prepare(sql){return{bind(){return{
  async first(){return sql.includes('FROM tennis_players')?athlete:null},
  async all(){return {results:sql.includes('FROM tennis_players WHERE fbis_player_id IN')?[athlete]:[]}}
 }}}}};
 const response=await onRequestGet({request:req(athlete.fbis_player_id),env:{DB}});
 const html=await response.text();
 assert.equal(response.status,200);
 assert.match(html,/class="portrait-frame"><img[^>]+alt="Rebecca Sramkova feed player portrait"/);
 assert.match(html,/\.portrait-frame\{width:100%;height:245px;overflow:hidden/);
 assert.match(html,/\.portrait-frame img\{width:100%;height:100%;display:block;object-fit:cover;object-position:center 18%/);
 assert.doesNotMatch(html,/object-fit:contain/);
 assert.match(html,/External provider image reference/);
});
