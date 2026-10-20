import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {parseComboLeg,parseComboTicket} from "../src/lib/comboTicket.js";

test("Kalshi 3-leg NFL combo is rendered as three exact selections",()=>{
  const combo=parseComboTicket({
    sport:"nfl",
    market:"3-MARKET COMBO / NFL TOUCHDOWN + PASSING YARDS + RUSHING YARDS",
    selectedTeam:"3-leg COMBO — George Kittle 1+ TD AND Brock Purdy 250+ passing yards AND Christian McCaffrey 40+ rushing yards"
  });
  assert.equal(combo.title,"3-LEG COMBO");
  assert.equal(combo.legs.length,3);
  assert.deepEqual(combo.legs.map(x=>[x.player,x.selection]),[
    ["George Kittle","1+ TD"],
    ["Brock Purdy","250+ passing yards"],
    ["Christian McCaffrey","40+ rushing yards"]
  ]);
});

test("MLB player-prop combo is found in the legacy playerName field and keeps team market whole",()=>{
  const combo=parseComboTicket({
    market:"PLAYER_PROP",
    playerName:"COMBO: Parker Messick 4+ strikeouts AND Tampa Bay first 3 innings — stat",
    selectedSide:"OVER",
    selectedTeam:"Parker Messick"
  });
  assert.equal(combo.title,"2-LEG COMBO");
  assert.equal(combo.legs.length,2);
  assert.equal(combo.legs[0].player,"Parker Messick");
  assert.equal(combo.legs[0].selection,"4+ strikeouts");
  assert.equal(combo.legs[1].text,"Tampa Bay first 3 innings — stat");
  assert.equal(combo.legs[1].player,null);
});

test("no guessed missing legs or stat lines for partial and noncombo tickets",()=>{
  assert.equal(parseComboTicket({market:"TOTAL",selectedSide:"Under 48.5"}),null);
  const partial=parseComboTicket({market:"3-MARKET COMBO",selectedTeam:"George Kittle 1+ TD"});
  assert.equal(partial.title,"COMBO");
  assert.equal(partial.legs.length,1);
  assert.equal(partial.advertisedCount,3);
  assert.deepEqual(parseComboLeg("Tampa Bay first 3 innings — stat"),{
    text:"Tampa Bay first 3 innings — stat",player:null,selection:null
  });
});

test("My Bets table drops only the displayed ticket column and retains ledger IDs for search",()=>{
  const view=fs.readFileSync("src/MyBetsView.jsx","utf8");
  const css=fs.readFileSync("src/myBets.css","utf8");
  assert.doesNotMatch(view,/<th>Ticket<\/th>/);
  assert.doesNotMatch(view,/className="bets-ticket-id"/);
  assert.match(view,/b\.externalTicketId/);
  assert.match(view,/<tr key=\{b\.id\}/);
  assert.match(view,/parseComboTicket\(b\)/);
  assert.match(view,/ComboSelection bet=\{b\} combo=\{combo\}/);
  assert.match(css,/nth-child\(10\)\{[\s\S]{0,150}font-weight:950/);
  assert.match(css,/\.bets-combo-leg/);
});
