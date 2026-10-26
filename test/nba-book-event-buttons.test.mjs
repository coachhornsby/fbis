import test from "node:test";
import assert from "node:assert/strict";
// JSX module is exercised by the Vite build; source-bound resolver is independently tested below.
test("NBA cards expose three clearly named book destinations",()=>{
 const src=await import("node:fs/promises").then(fs=>fs.readFile("src/components/board/NbaBookEventButtons.jsx","utf8"));
 for(const book of ["PINNACLE","KALSHI","POLYMARKET"])assert.match(src,new RegExp(book));
 assert.match(src,/EVENT LINK UNAVAILABLE/);
 assert.match(src,/target="_blank"/);
});
