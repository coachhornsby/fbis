import test from "node:test";
import assert from "node:assert/strict";
import { gapBrandColor, gapDirection } from "../src/lib/marketGapBrand.js";

test("verified event color has priority for spread-side branding across sports",()=>{
 assert.equal(gapBrandColor({abbr:"ABC",color:"#7333CC"},{color:"#335577"},"cfb"),"#7333CC");
 assert.equal(gapBrandColor({abbr:"ABC",color:"#7333CC"},{color:"#335577"},"nba"),"#7333CC");
 assert.equal(gapBrandColor({abbr:"ABC",color:"#7333CC"},{color:"#335577"},"soccer"),"#7333CC");
 assert.equal(gapBrandColor({abbr:"ABC",color:"#7333CC"},{color:"#335577"},"mlb"),"#7333CC");
});
test("hockey clubs reuse existing verified NHL color catalog if event color absent",()=>{
 assert.equal(gapBrandColor({abbr:"BOS"},{},"nhl"),"#FFC422");
 assert.equal(gapBrandColor({abbr:"NYR"},{},"nhl"),"#0161AB");
});
test("branded gap remains neutral for unknown teams and prefers known secondary for dark team marks",()=>{
 assert.equal(gapBrandColor({abbr:"UNKNOWN"},{abbr:"UNKNOWN"},"cbb"),null);
 assert.equal(gapBrandColor({color:"#000000",secondaryColor:"#F4B424"},null,"cfb"),"#F4B424");
 assert.equal(gapBrandColor({color:"#FFFFFF",secondaryColor:"#285AA6"},null,"nfl"),"#285AA6");
});
test("only actual O/U directions may receive directional colors",()=>{
 assert.equal(gapDirection("over"),"over");
 assert.equal(gapDirection("UNDER"),"under");
 assert.equal(gapDirection("equal"),"even");
 assert.equal(gapDirection(null),"even");
});
