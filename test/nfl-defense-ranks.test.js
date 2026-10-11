import test from "node:test";
import assert from "node:assert/strict";
import {nflDefenseRanks} from "../functions/api/nfl-defense-ranks.js";
test("32-team NFL pass/run ranking is complete and strongest EPA ranks first",()=>{
 const byTeam=Object.fromEntries(Array.from({length:32},(_,i)=>["T"+String(i+1),{passEpaAllowed:i/100-0.2,rushEpaAllowed:(31-i)/100-0.2}]));
 const ranks=nflDefenseRanks({byTeam});
 assert.equal(Object.keys(ranks).length,32);
 assert.equal(ranks.T1.pass.rank,1);
 assert.equal(ranks.T32.run.rank,1);
});
test("incomplete NFL defense dataset cannot masquerade as a complete league ranking",()=>{
 const ranks=nflDefenseRanks({byTeam:{SF:{passEpaAllowed:-0.2,rushEpaAllowed:-0.1}}});
 assert.deepEqual(ranks,{});
});
