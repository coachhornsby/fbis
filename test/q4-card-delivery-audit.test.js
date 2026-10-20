import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQ4CardDelivery } from "../scripts/lib/q4CardDeliveryAudit.mjs";

test("Q4 card delivery passes when fresh observations match board cards with provenance", () => {
  const now = new Date("2026-10-20T13:00:00.000Z");
  const report = evaluateQ4CardDelivery({
    now,
    q4Observations: [
      {
        canonical_event_id: "401892540",
        source: "Polymarket US WebSocket",
        source_market_id: "aec-nhl-col-nj-2026-10-20",
        collected_at: "2026-10-20T12:55:00.000Z",
        source_observed_at: "2026-10-20T12:54:50.000Z",
        market_family: "moneyline",
      },
    ],
    boardGames: [
      {
        id: "401892540",
        sport: "nhl",
        market: {
          venueOffers: [
            {
              source: "Polymarket US WebSocket",
              deliveryStore: "MARKET_HISTORY_2026Q4",
              collectedAt: "2026-10-20T12:55:00.000Z",
            },
          ],
        },
      },
    ],
  });
  assert.equal(report.ok, true);
  assert.equal(report.counts.matchedEvents, 1);
  assert.equal(report.counts.cardsWithQ4Provenance, 1);
});

test("Q4 card delivery fails closed when fresh observations exist but board has no matching games", () => {
  const now = new Date("2026-10-20T13:00:00.000Z");
  const report = evaluateQ4CardDelivery({
    now,
    q4Observations: [
      {
        canonical_event_id: "401892540",
        source: "Polymarket US WebSocket",
        source_market_id: "aec-nhl-col-nj-2026-10-20",
        collected_at: "2026-10-20T12:55:00.000Z",
      },
    ],
    boardGames: [{ id: "999", sport: "nhl", market: { venueOffers: [] } }],
  });
  assert.equal(report.ok, false);
  assert.ok(report.failures.includes("Q4_EVENTS_NOT_ON_BOARD"));
});
