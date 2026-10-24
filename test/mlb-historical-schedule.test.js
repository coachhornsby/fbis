import test from 'node:test';
import assert from 'node:assert/strict';
import {mlbCanonicalScheduleDays} from '../functions/lib/mlbHistoricalSchedule.js';
test('a resumed game listed on two dates is archived once under its official date',()=>{
 const g={gamePk:745180,officialDate:'2024-05-21',status:{codedGameState:'F'}};
 const s=mlbCanonicalScheduleDays({totalGames:2,dates:[{date:'2024-05-21',games:[g]},{date:'2024-05-22',games:[{...g,resumedFrom:'2024-05-21T23:45:00Z'}]}]});assert.deepEqual(s.gamesByDate.get('2024-05-21'),['745180']);assert.equal(s.gamesByDate.has('2024-05-22'),false);
});
test('unfinished scheduled games stay pending and conflicting official identities reject',()=>{
 const g={gamePk:1,officialDate:'2026-10-24',status:{codedGameState:'P',detailedState:'Scheduled'}};
 const s=mlbCanonicalScheduleDays({totalGames:1,dates:[{date:'2026-10-24',games:[g]}]});assert.deepEqual(s.pendingByDate.get('2026-10-24'),['1']);assert.equal(s.gamesByDate.size,0);
 assert.throws(()=>mlbCanonicalScheduleDays({totalGames:2,dates:[{date:'2026-10-24',games:[g,{...g,officialDate:'2026-10-25'}]}]}));
});
