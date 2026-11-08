// Private derived-score view, not a source collector or public publication.
const urls=['https://barttorvik.com/2027_team_results.csv','https://barttorvik.com/2027_fffinal.csv'];
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
export function privateTorvikSummary(p,{date,now=Date.now()}={}){
 if(p?.version!==1||p.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||p.season!==2027||p.canAuthorizeWager!==false||!iso(p.generatedAt)||!iso(p.expiresAt)||Date.parse(p.generatedAt)>now||Date.parse(p.expiresAt)<=Date.parse(p.generatedAt)||Date.parse(p.expiresAt)-Date.parse(p.generatedAt)>6*3600000||!Array.isArray(p.events)||p.events.length>1000)throw Error('INVALID_PRIVATE_TORVIK_PACKET');
 const v=p.torvikProvenance;
 if(v?.season!==2027||v.usage!=='PRIVATE_COMPARISON_ONLY'||v.providerUpdatedAt!==null||!Array.isArray(v.receipts)||v.receipts.length!==2)throw Error('NO_VERIFIED_PRIVATE_TORVIK_INPUT');
 for(let i=0;i<2;i++){const r=v.receipts[i];if(r.url!==urls[i]||r.httpStatus!==200||!iso(r.retrievedAt)||Date.parse(r.retrievedAt)>now||Date.parse(r.retrievedAt)>Date.parse(p.expiresAt)||Date.parse(r.retrievedAt)<Date.parse(p.generatedAt)-6*3600000||!/^[a-f0-9]{64}$/.test(r.sha256||''))throw Error('INVALID_TORVIK_SOURCE_RECEIPT');}
 const retrievedAt=v.receipts.map(r=>r.retrievedAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0],seen=new Set(),events=[];
 for(const e of p.events){
  if(!e.comparison)continue;const q=e.comparison;
  if(e.date!==date||!/^\d+$/.test(e.eventId)||seen.has(e.eventId)||!/^cbb-\d+$/.test(e.homeId)||!/^cbb-\d+$/.test(e.awayId)||e.homeId===e.awayId||!iso(e.start)||Date.parse(e.start)<=Date.parse(retrievedAt)||typeof e.neutralSite!=='boolean'||q.comparisonOnly!==true||q.canAuthorizeWager!==false||!['home','away','margin','total'].every(k=>Number.isFinite(q[k]))||q.home<0||q.away<0||q.home>200||q.away>200||Math.abs(q.home-q.away-q.margin)>.21||Math.abs(q.home+q.away-q.total)>.21)throw Error('INVALID_PRIVATE_TORVIK_EVENT');
  seen.add(e.eventId);events.push({eventId:e.eventId,date:e.date,start:e.start,homeId:e.homeId,awayId:e.awayId,neutralSite:e.neutralSite,comparison:{home:q.home,away:q.away,margin:q.margin,total:q.total}});
 }
 return {version:1,scope:'PRIVATE_TORVIK_COMPARISONS',season:2027,date,generatedAt:p.generatedAt,expiresAt:p.expiresAt,retrievedAt,providerUpdatedAt:null,events,canAuthorizeWager:false};
}
export function torvikComparisonFor(game,p,clock=Date.now()){
 if(game?.sport!=='cbb'||p?.scope!=='PRIVATE_TORVIK_COMPARISONS'||p.canAuthorizeWager!==false||game.date!==p.date)return null;
 const e=p.events.find(e=>e.eventId===String(game.id));
 if(!e||e.date!==game.date||Date.parse(e.start)!==Date.parse(game.start)||e.homeId!==`cbb-${game.home?.espnId}`||e.awayId!==`cbb-${game.away?.espnId}`||e.neutralSite!==game.neutralSite)return null;
 return {...e,expired:clock>=Date.parse(p.expiresAt),started:clock>=Date.parse(e.start)||['live','final'].includes(game.status),statusUnverified:!['scheduled','live','final'].includes(game.status),retrievedAt:p.retrievedAt,expiresAt:p.expiresAt};
}
