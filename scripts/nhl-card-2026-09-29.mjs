import { loadNhlV1Context, projectNhlV1Game } from "../functions/lib/nhlFbisV1.js";

const games=[
  {away:{abbr:"FLA"},home:{abbr:"CAR"},start:"2026-09-29T21:00:00Z",odds:{total:6.5,spread:-1.5},heritage:{awayMl:107,homeMl:-129,over:101,under:-122,awayPl:-239,homePl:192}},
  {away:{abbr:"MTL"},home:{abbr:"TOR"},start:"2026-09-29T23:00:00Z",odds:{total:6.5,spread:1.5},heritage:{awayMl:-110,homeMl:-110,over:-101,under:-120,awayPl:199,homePl:-326}},
  {away:{abbr:"NYR"},home:{abbr:"BOS"},start:"2026-09-30T00:00:00Z",odds:{total:6,spread:1.5},heritage:{awayMl:-107,homeMl:-113,over:-103,under:-118,awayPl:195,homePl:-318}},
  {away:{abbr:"VAN"},home:{abbr:"EDM"},start:"2026-09-30T02:00:00Z",odds:{total:6.5,spread:-1.5},heritage:{awayMl:242,homeMl:-309,over:-115,under:-105,awayPl:101,homePl:-122}},
  {away:{abbr:"CHI"},home:{abbr:"VGK"},start:"2026-09-30T02:30:00Z",odds:{total:6,spread:-1.5},heritage:{awayMl:211,homeMl:-265,over:-106,under:-114,awayPl:-124,homePl:103}},
];
const ctx=await loadNhlV1Context("2026-09-29",games);
const americanToProb=o=>o<0?(-o)/((-o)+100):100/(o+100);
const fairAmerican=p=>p>=.5?-Math.round(100*p/(1-p)):Math.round(100*(1-p)/p);
for(const g of games){
  const p=projectNhlV1Game(g,ctx);
  const h=g.heritage;
  const row={matchup:`${g.away.abbr}@${g.home.abbr}`,projection:p,
    market:{
      awayMl:h.awayMl,homeMl:h.homeMl,
      awayMlImp:americanToProb(h.awayMl),homeMlImp:americanToProb(h.homeMl),
      over:h.over,under:h.under,overImp:americanToProb(h.over),underImp:americanToProb(h.under)
    },
    fair:{
      homeMl:fairAmerican(p.probability.homeWinIncludingOt),
      awayMl:fairAmerican(p.probability.awayWinIncludingOt),
      homeWin:p.probability.homeWinIncludingOt,
      awayWin:p.probability.awayWinIncludingOt,
      over:p.probability.over,under:p.probability.under,push:p.probability.push
    }
  };
  console.log("CARDJSON "+JSON.stringify(row));
}
