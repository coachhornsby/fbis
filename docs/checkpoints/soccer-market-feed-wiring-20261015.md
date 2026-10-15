# Soccer market feeds — October 15, 2026

PinnOdds is the intended sportsbook source. Polymarket US WebSocket is the exchange price/probability reference. Keep each source separate from independent FBIS probabilities.

Live D1 verification found 10,071 PinnOdds soccer observations, 38,101 Polymarket REST observations and 9,009 WebSocket observations. These are historical observation counts, not fresh event coverage. PinnOdds latest collection was 2026-10-15T00:39:19.078Z. Socket collection was active at 05:42:43.250Z. PinnOdds and socket provider quote timestamps were null. Only one matched soccer event had socket observations collected after 05:00Z; most new socket observations did not link to a canonical event. Do not claim complete slate coverage.

Repairs: include soccer PinnOdds decimal prices in the post-model board overlay; show full-game book references on compact and expanded cards; accept WebSocket offers in both cards' exchange probability strip. Preserve exact event matching, source labels, existing freshness checks, and unknown provider timestamps. Historical captures remain accessible through Market Details. Do not redate old prices or populate missing outcomes.

Remaining work: reconcile provider event identities across the soccer slate; verify provider quote clocks or explicitly define and validate a collection-only evidence policy; connect complete, coherent 1X2/BTTS markets to the prospective ledger. Current shadow collector hardcodes 1X2 and BTTS as unavailable. No betting qualification or model authority change is included in the display repair.

Validation: nine board overlay and temporal tests passed; Vite production build passed with existing unrelated warnings.
