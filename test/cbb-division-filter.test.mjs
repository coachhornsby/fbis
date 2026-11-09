import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import teams from '../data/teams/cbb.js';
import {cbbTeamDivision,cbbDivisionScope} from '../src/lib/cbbDivisionFilter.js';
const game=(home,away,extra={})=>({sport:'cbb',home,away,...extra});
test('canonical D1 identity retains games without source classification, models or markets',()=>{
 const g=game({espnId:'194'},{espnId:'84'},{model:null,projectionUnavailable:true,odds:{}});
 assert.deepEqual(cbbDivisionScope([g]).games,[g]);
});
test('all current registry teams including new entrants remain eligible',()=>{
 assert.equal(teams.length,365);for(const t of teams)assert.equal(cbbTeamDivision({espnId:t.espnId}),'D1');
});
test('unknown or non-D1 opponents never gain eligibility through names or projections',()=>{
 const bad=[{espnId:'999999',name:'Ohio State Buckeyes'},{classification:'D2'},{division:'Division I'},{conference:'ACC'},{}];
 for(const t of bad){const g=game({espnId:'194'},t,{model:{home:90,away:60}});assert.deepEqual(cbbDivisionScope([g]),{games:[],unverified:[g]});}
});
test('explicit source classification supports verified new D1 entrants',()=>{
 for(const classification of ['D1','Division I','Division 1','NCAA DI'])assert.equal(cbbTeamDivision({espnId:'999999',classification}),'D1');
});
test('other sports are not filtered',()=>{
 const g={sport:'nba',home:{},away:{}};assert.deepEqual(cbbDivisionScope([g]).games,[g]);
});
test('cards, counts and ticker share one division scope and disclose hidden unverified fixtures',()=>{
 const src=readFileSync(new URL('../src/PublicationApp.jsx',import.meta.url),'utf8');
 assert.match(src,/const games=divisionScope\.games\.filter/);
 assert.match(src,/<PublicScoreTicker games=\{divisionScope\.games\.filter/);
 assert.match(src,/divisionScope\.games\.filter\(g=>g\.sport===s/);
 assert.match(src,/both teams are not verified Division I/);
});
