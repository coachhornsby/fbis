import test from "node:test";
import assert from "node:assert/strict";
import { fetchEspnTennisRankings, espnCountry } from "../functions/lib/tennisPrizePicksResearch.js";

test("ESPN ATP rankings use working host and retain sourced citizenship and rank",async()=>{
 const calls=[];
 const api=async url=>{
  calls.push(url);
  assert.match(url,/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/tennis\/(atp|wta)\/rankings/);
  const atp=url.includes("/atp/");
  return {ok:true,json:async()=>({rankings:[{ranks:[atp?
    {current:45,points:1151,athlete:{id:"9992",displayName:"Mariano Navone",citizenshipCountry:"ARG"}}:
    {current:42,points:1273,athlete:{id:"329393",displayName:"Talia Gibson",citizenshipCountry:"AUS"}}]}]})};
 };
 const r=await fetchEspnTennisRankings(api);
 assert.equal(calls.length,2);
 assert.deepEqual([r.byName.get("mariano navone")?.rank,r.byName.get("mariano navone")?.points,r.byName.get("mariano navone")?.country],[45,1151,"AR"]);
 assert.deepEqual([r.byName.get("talia gibson")?.rank,r.byName.get("talia gibson")?.country],[42,"AU"]);
});
test("unknown or absent citizenship never guesses a nationality",async()=>{
 const r=await fetchEspnTennisRankings(async()=>({ok:true,json:async()=>({rankings:[{ranks:[{current:1,points:100,athlete:{displayName:"Unknown Athlete",citizenshipCountry:"XYZ"}}]}]})}));
 assert.equal(r.byName.get("unknown athlete")?.country,null);
});

test("ESPN event flags use SER for Serbia alongside SRB",()=>{assert.equal(espnCountry({citizenshipCountry:"SER"}),"RS");assert.equal(espnCountry({citizenshipCountry:"SRB"}),"RS");});
