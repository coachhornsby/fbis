// Reconciled from the operator's Sports Betting Tracker workbook on 2026-09-21.
// Idempotent because executed_bets is unique on (execution_book, external_ticket_id).
const M = (portfolio, eligibility, provenanceId, notes, extra={}) => ({
  portfolio, calibrationEligibility: eligibility, provenanceId, notes, ...extra
});
export const BET_TRACKER_RECONCILE_SEED = [
  ["G11861654","Heritage","mlb","2026-09-19","MIL @ BAL","Milwaukee Brewers","ML",null,-110,2.2,2,"WON",2,"2026-09-19 09:47 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 1-0")],
  ["G11861796","Heritage","cfb","2026-09-19","Arizona State @ Kansas","Kansas +5.5","SPREAD",5.5,-110,2.2,2,"LOST",-2.2,"2026-09-19 09:49 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 24-17")],
  ["G11861794","Heritage","cfb","2026-09-19","SMU @ Louisville","Louisville -1.5","SPREAD",-1.5,-110,2.2,2,"WON",2,"2026-09-19 09:49 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 41-31")],
  ["G11861655","Heritage","mlb","2026-09-19","KC @ PIT","Pittsburgh Pirates","ML",null,-114,2.28,2,"WON",2,"2026-09-19 09:47 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 6-5")],
  ["G11861656","Heritage","mlb","2026-09-19","WSH @ STL","Washington Nationals","ML",null,103,2,2.06,"WON",2.06,"2026-09-19 09:47 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 8-5 in 11; latest verified consensus showed Washington -108")],
  ["G11861797","Heritage","cfb","2026-09-19","LSU @ Ole Miss","Ole Miss +3","SPREAD",3,-110,2.2,2,"WON",2,"2026-09-19 09:49 CT",M("Straight","INELIGIBLE - PRE-GOV",null,"Final 32-24; consensus close Ole Miss +3")],

  ["G11913875","Heritage","mlb","2026-09-20","ATH @ CLE","Cleveland Guardians -0.5 F5","F5 SPREAD",-0.5,-160,3.25,2.03,"WON",2.03,"2026-09-20 00:34 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-CLE-F5","Final 1-0 Cleveland; run scored in 4th; CLE -0.5 F5 won",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"MLB-BET-v1.0"})],
  ["G11913845","Heritage","nfl","2026-09-20","CAR @ ATL","Carolina Panthers -2.5","SPREAD",-2.5,-119,2.39,2,"WON",2,"2026-09-20 00:33 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-CAR","Final 34-3 Carolina",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"NFL-BET-v1.0"})],
  ["G11913840","Heritage","mlb","2026-09-20","MIL @ BAL","Milwaukee Brewers -0.5 F5","F5 SPREAD",-0.5,-153,3.08,2.01,"WON",2.01,"2026-09-20 00:33 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-MIL-F5","Milwaukee -0.5 F5 covered",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"MLB-BET-v1.0"})],
  ["G11913844","Heritage","nfl","2026-09-20","JAX @ DEN","Denver Broncos -3","SPREAD",-3,-101,2.03,2,"WON",2,"2026-09-20 00:33 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-DEN","Final 20-13 Denver",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"NFL-BET-v1.0"})],
  ["G11913843","Heritage","nfl","2026-09-20","SEA @ ARI","Under 40.5","TOTAL",40.5,-106,2.12,2,"WON",2,"2026-09-20 00:33 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-SEAARI-U","Final 31-7 Seattle; 38 total",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"NFL-BET-v1.0"})],
  ["G11913842","Heritage","nfl","2026-09-20","CIN @ HOU","Under 45.5","TOTAL",45.5,-110,2.2,2,"WON",2,"2026-09-20 00:33 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-CINHOU-U","Final 20-6 Cincinnati; 26 total",{marketSeenBeforeModel:true,gateFailReason:"Market visible before independently locked projection",modelVersion:"NFL-BET-v1.0"})],
  ["G11913254","Heritage","npb","2026-09-20","Seibu @ Chiba Lotte","Saitama Seibu Lions","ML",null,-127,2.54,2,"VOID",0,"2026-09-20 00:17 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-SEIBU","Game cancelled; void",{marketSeenBeforeModel:true,modelVersion:"NPB-BET-v0.1",experimental:true})],
  ["G11914731","Heritage","tennis","2026-09-20","Duckworth vs Kasnikowski","James Duckworth -1.5 sets","SPREAD",-1.5,115,2,2.3,"VOID",0,"2026-09-20 01:00 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-DUCKWORTH","Davis Cup tie clinched before fifth rubber; not played",{marketSeenBeforeModel:true,modelVersion:"TENNIS-BET-v0.1",experimental:true})],
  ["G11914730","Heritage","tennis","2026-09-20","Kecmanovic vs Gaubas","Miomir Kecmanovic -1.5 sets","SPREAD",-1.5,-120,2.4,2,"VOID",0,"2026-09-20 01:00 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-KECMANOVIC","Heritage void",{marketSeenBeforeModel:true,modelVersion:"TENNIS-BET-v0.1",experimental:true})],
  ["G11914729","Heritage","tennis","2026-09-20","Medjedovic vs Butvilas","Hamad Medjedovic -1.5 sets","SPREAD",-1.5,-160,3.2,2,"VOID",0,"2026-09-20 01:00 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-MEDJEDOVIC","Heritage void",{marketSeenBeforeModel:true,modelVersion:"TENNIS-BET-v0.1",experimental:true})],
  ["G11915082","Heritage","soccer","2026-09-20","Getafe vs Malaga","Getafe -0.5","SPREAD",-0.5,100,2,2,"WON",2,"2026-09-20 01:12 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-GETAFE","Booked 01:12 CT; line unchanged",{marketSeenBeforeModel:true,modelVersion:"SOCCER-BET-v0.1",experimental:true})],
  ["G11915037","Heritage","soccer","2026-09-20","Manchester City vs Sunderland","Under 3.5","TOTAL",3.5,-181,3.62,2,"LOST",-3.62,"2026-09-20 01:11 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-MCISUN-U","Booked 01:11 CT",{marketSeenBeforeModel:true,modelVersion:"SOCCER-BET-v0.1",experimental:true})],
  ["G11915005","Heritage","soccer","2026-09-20","Leeds United vs Crystal Palace","Leeds United -0.75","SPREAD",-0.75,-117,2.34,2,"LOST",-2.34,"2026-09-20 01:09 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-LEEDS","Booked 01:09 CT",{marketSeenBeforeModel:true,modelVersion:"SOCCER-BET-v0.1",experimental:true})],
  ["NOVIG-01a09c81-2485-7723-aa03-f73d682f1841","Novig","soccer","2026-09-20","Manchester United @ Fulham","Manchester United - 3-Way ML","ML",null,99,2,1.98,"LOST",-2,"2026-09-20 10:34 CT",M("Straight","INELIGIBLE - LIVE/USER-PLACED","PROV-20260920-MUNFUL-NOVIG","Live matched at 49.0%, score 0-0 in 5th minute",{marketSeenBeforeModel:true,live:true})],
  ["NOVIG-01a0bd21-8451-7661-bb71-5f9331d983d0","Novig","wnba","2026-09-20","Seattle Storm @ Las Vegas Aces","Seattle Storm +16.5","SPREAD",16.5,102,1.8,1.83,"OPEN",0,"2026-09-20 11:23 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-SEA-LV-NOVIG","Matched at 49.5%; $1.80 amount; $3.63 total payout",{marketSeenBeforeModel:true,modelVersion:"WNBA-BET-v0.1"})],
  ["NOVIG-01a07c6a-a738-7271-9f71-0a697d289242","Novig","nfl","2026-09-20","Miami Dolphins @ San Francisco 49ers","San Francisco 49ers -13.5","SPREAD",-13.5,104,0,10.2,"WON",0,"2026-09-20 11:29 CT",M("Novig Promo","INELIGIBLE - PROMO/USER-SELECTED","PROV-20260920-SF-MIA-NOVIG-PROMO","49ers won 35-13; $5 Trade Credit had no cash risk",{marketSeenBeforeModel:true,promo:true,userSelected:true})],
  ["G11936457","Heritage","mlb","2026-09-20","KC @ PIT","Pittsburgh Pirates","ML",null,-114,2.28,2,"WON",2,"2026-09-20 09:41 CT",M("Straight","INELIGIBLE - TRANSITION","PROV-20260920-PIT-ML","Final 4-3 Pittsburgh",{marketSeenBeforeModel:true,modelVersion:"MLB-BET-v1.0"})],
  ["PP-PROTECTED-20260920-1440","PrizePicks","nfl","2026-09-20","MIA @ SF / IND @ KC","Caleb Douglas O3.5 rec / Josh Downs O42.5 rec yds / Alec Pierce O44.5 rec yds / Emmett Johnson O7.5 rec yds","PLAYER_PROP",null,null,15,165,"LOST",-15,"2026-09-20 14:40 CT",M("PrizePicks","INELIGIBLE - MARKET-SEEN","PROV-20260920-PP-PROTECTED-4","$15 Protected Power Play lost; reimbursement is Bonus Lineups, not cash",{marketSeenBeforeModel:true,protectedPlay:true,modelVersion:"PP-PROP-v0.1"})],
].map(([externalTicketId,executionBook,sport,date,matchupText,selectedTeam,market,executionLine,executionPrice,riskAmount,toWinAmount,result,profit,executedAt,trackerMetadata]) => {
  const [awayTeam,homeTeam] = matchupText.includes(" @ ") ? matchupText.split(" @ ",2) : [null,null];
  const selectedSide = /^under\b/i.test(selectedTeam) ? "UNDER" : /^over\b/i.test(selectedTeam) ? "OVER" : null;
  return {
    externalTicketId, executionBook, sport, date, matchupText, awayTeam, homeTeam,
    market, period: market.startsWith("F5 ") ? "F5" : "FG", selectedSide, selectedTeam,
    executionLine, executionPrice, riskAmount, toWinAmount,
    potentialPayout: Number(riskAmount || 0) + Number(toWinAmount || 0),
    executedAt, timezone:"America/Chicago", importSource:"sports-betting-tracker-reconcile",
    matchStatus:"tracker-reconciled", recommendationStatus:"TRACKER_RECONCILED",
    result, profit, settledReturn: result === "WON" ? Number(riskAmount||0)+Number(toWinAmount||0) : result === "LOST" ? 0 : result === "VOID" ? Number(riskAmount||0) : null,
    gradedAt: result === "OPEN" ? null : "2026-09-21T00:00:00.000Z",
    attributionLabel:"TRACKER RECONCILED", trackerMetadata,
    modelVersionAtEntry: trackerMetadata.modelVersion || null,
    clvStatus:"unavailable"
  };
});
