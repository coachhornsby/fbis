import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {onRequestGet} from "../functions/api/tennis-players.js";
function memory(){
 const db=new DatabaseSync(":memory:");
 db.exec(`CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,tour TEXT,canonical_name TEXT,normalized_name TEXT,
 country_code TEXT,current_rank INTEGER,ranking_points INTEGER,active_state TEXT,official_source TEXT,official_observed_at TEXT,
 official_headshot_url TEXT,official_headshot_source TEXT);
 CREATE TABLE tennis_player_portraits(fbis_player_id TEXT,asset_key TEXT,content_type TEXT,approval_status TEXT,public_display_allowed INTEGER,
 display_scope TEXT,rights_evidence_ref TEXT,source_reference TEXT,approved_at TEXT,expires_at TEXT,attribution_text TEXT);`);
 const ins=db.prepare("INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
 ins.run("tennis:wta:1","wta","Approved Player","approved player","US",1,9100,"RANKED_ACTIVE","WTA_OFFICIAL","2026-10-20",null,null);
 ins.run("tennis:wta:2","wta","External Player","external player","PL",12,2400,"RANKED_ACTIVE","WTA_OFFICIAL","2026-10-20","https://static.prizepicks.com/players/2.png","PRIZEPICKS_FEED");
 ins.run("tennis:wta:3","wta","Team Logo Player","team logo player","GB",null,null,"KNOWN_UNRANKED","WTA_OFFICIAL","2026-10-20","https://img0.aiscore.com/v2/team/not-a-player.png!w80","PRIZEPICKS_FEED");
 ins.run("tennis:atp:research:novak djokovic","atp","Novak Djokovic","novak djokovic","RS",null,null,"UNKNOWN","FBIS_SUPPLEMENTAL_RESEARCH","2026-10-20",null,null);
 db.prepare("INSERT INTO tennis_player_portraits VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
 "tennis:wta:1","tennis/portraits/tennis:wta:1/licensed.webp","image/webp","APPROVED",1,"PUBLIC_WEB",
 "https://creativecommons.org/licenses/by/4.0/","https://commons.wikimedia.org/wiki/File:Approved.jpg","2026-01-01T00:00:00Z",null,"Source credit");
 return {prepare(sql){return {bind(...args){return{
   async all(){return {results:db.prepare(sql).all(...args)}},
   async first(){return db.prepare(sql).get(...args)||null}
 }}}}};
}
const load=(query="",db=memory())=>onRequestGet({request:new Request("https://fbis.test/api/tennis-players"+query),env:{DB:db}});
test("Teams Tennis players are paged and R2 assets take priority over external URLs",async()=>{
 const r=await load("?tour=wta"),x=await r.json();
 assert.equal(r.status,200);assert.equal(x.total,3);assert.equal(x.pages,1);
 assert.equal(x.players[0].portraitSource,"APPROVED_R2");
 assert.equal(x.players[0].portraitUrl,"/api/tennis-portrait?id=tennis%3Awta%3A1");
 assert.equal(x.players[0].portraitCredit,"Source credit");
 assert.equal(x.players[1].portraitSource,"EXTERNAL_FEED");
 assert.equal(x.players[1].portraitUrl,"https://static.prizepicks.com/players/2.png");
 assert.equal(x.players[2].portraitSource,"MISSING");
 assert.equal(x.players[2].portraitUrl,null);
 assert.equal(x.players[1].profileUrl,"/api/tennis-player-profile?id=tennis%3Awta%3A2");
});
test("tour, percent-sign search, ranking filter and space-bearing ATP profile links",async()=>{
 const ranked=await(await load("?tour=wta&scope=ranked")).json();assert.equal(ranked.total,2);
 const search=await(await load("?tour=wta&q=%25")).json();assert.equal(search.total,0);
 const atp=await(await load("?tour=atp&q=novak")).json();
 assert.equal(atp.total,1);assert.equal(atp.players[0].name,"Novak Djokovic");
 assert.match(atp.players[0].profileUrl,/novak%20djokovic/);
 assert.equal((await load("?tour=invalid")).status,400);
 assert.equal((await load("?tour=atp",{})).status,503);
});
test("Teams includes a separate Tennis dropdown and recognizes official ATP and 2025+ WTA marks",()=>{
 const view=readFileSync(new URL("../src/features/teamProfiles/TeamProfilesView.jsx",import.meta.url),"utf8");
 const players=readFileSync(new URL("../src/features/teamProfiles/TennisPlayersView.jsx",import.meta.url),"utf8");
 assert.match(view,/value="tennis">Tennis — ATP \/ WTA/);
 assert.match(view,/sport==='tennis'\?<TennisPlayersView/);
 assert.match(players,/WTA_2025\.svg/);
 assert.match(players,/ATP_Tour_logo\.svg/);
 assert.match(players,/tp-player-card/);
 assert.match(players,/profileUrl/);
});
