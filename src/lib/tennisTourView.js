// Presentation only. Never rewrite sport, event ID, participant or market objects.
export function tennisClassification(game={}) {
 const t=game.tennisProjection||{};
 const tags=[game.tour,t.tour].filter(Boolean).map(x=>String(x).toLowerCase());
 const known=[...new Set(tags.filter(x=>['atp','wta'].includes(x)))];
 const tour=known.length===1?known[0]:null;
 const context=[t.tournament,t.tournamentLevel,t.competition,t.format,game.competition?.name].filter(x=>typeof x==='string').join(' ');
 const doubles=/\bdoubles?\b|\bpairs\b/i.test(context);
 const level=/\bitf\b/i.test(context)?'ITF':/challenger/i.test(context)?'Challenger':/\b125\b/.test(context)?'WTA 125':
  /grand slam/i.test(context)?'Grand Slam':t.tournamentLevel?String(t.tournamentLevel):'Level unverified';
 return {tour,doubles,level,format:doubles?'Doubles':/\bsingles\b/i.test(context)?'Singles':'Format unverified',
  label:level==='ITF'?`ITF ${tour==='atp'?'Men':tour==='wta'?'Women':''}`.trim():tour?.toUpperCase()||'Tennis · tour unverified'};
}
export function filterTennisTour(games=[],tour='all'){
 if(!['atp','wta'].includes(tour))return games;
 return games.filter(g=>{const c=tennisClassification(g);return g.sport==='tennis'&&c.tour===tour&&!c.doubles;});
}
export function boardSportCounts(groups=[]){
 const counts={all:0,atp:0,wta:0};const seen=new Set();
 for(const group of groups)for(const g of group.games||[]){const key=`${g.sport}:${g.id}`;if(seen.has(key))continue;seen.add(key);
  counts.all++;counts[g.sport]=(counts[g.sport]||0)+1;
  if(g.sport==='tennis'){const c=tennisClassification(g);if(c.tour&&!c.doubles)counts[c.tour]++;}
 }return counts;
}
