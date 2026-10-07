const KEY = process.env.ODDSPAPI_KEY;
const base = 'https://api.oddspapi.io/v4';
const get = async (p) => (await fetch(`${base}/${p}${p.includes('?')?'&':'?'}apiKey=${KEY}`)).json();
const tt = await get('tournaments?sportId=12');
const list = Array.isArray(tt)?tt:tt?.data||[];
const active = list.filter(t => (t.upcomingFixtures||0)+(t.liveFixtures||0) > 0);
let f = null;
for (const t of active.slice(0, 20)) {
  const fx = await get(`fixtures?tournamentId=${t.tournamentId}`);
  const fl = Array.isArray(fx)?fx:fx?.data||[];
  f = fl.find(x => x.hasOdds);
  if (f) break;
}
console.log('fixture:', f ? `${f.participant1Name} vs ${f.participant2Name} (${f.fixtureId})` : 'none with odds');
if (f) {
  const variants = [
    `odds?fixtureId=${f.fixtureId}`,
    `odds?fixtureId=${f.fixtureId}&bookmaker=pinnacle`,
    `odds?fixtureId=${f.fixtureId}&bookmaker=pinnacle&markets=all`,
    `fixture-odds?fixtureId=${f.fixtureId}`,
  ];
  for (const v of variants) {
    const r = await get(v);
    console.log(`\n===== ${v} =====`);
    console.log('top-level keys:', Object.keys(r||{}));
    console.log(JSON.stringify(r).slice(0, 1500));
  }
}
