import test from "node:test";
import assert from "node:assert/strict";
import { parseFanDuelSlip } from "../functions/lib/fanduelSlip.js";

test("FanDuel straight spread parses execution truth", async () => {
  const out = await parseFanDuelSlip(`FanDuel Sportsbook
Bet ID ABC123456789
NFL
Miami Dolphins @ San Francisco 49ers
Spread
San Francisco 49ers -13.5
Odds +104
Wager $5.00
Potential Payout $10.20
Placed 09/20/2026`);
  assert.equal(out.tickets.length,1);
  const t=out.tickets[0];
  assert.equal(t.executionBook,"FanDuel");
  assert.equal(t.sport,"nfl");
  assert.equal(t.market,"SPREAD");
  assert.equal(t.executionLine,-13.5);
  assert.equal(t.riskAmount,5);
  assert.equal(t.potentialPayout,10.2);
  assert.equal(t.externalTicketId,"ABC123456789");
});

test("FanDuel missing ticket id gets stable content fingerprint id", async () => {
  const slip=`FanDuel MLB Kansas City Royals @ Pittsburgh Pirates Moneyline: Pittsburgh Pirates
Wager $2.00 Potential Payout $3.75 09/21/2026`;
  const a=(await parseFanDuelSlip(slip)).tickets[0];
  const b=(await parseFanDuelSlip(slip)).tickets[0];
  assert.match(a.externalTicketId,/^FD-[A-F0-9]{16}$/);
  assert.equal(a.externalTicketId,b.externalTicketId);
  assert.ok(a.trackerMetadata.contentFingerprint);
});
