/** TennisMyLife canonical 2026 R2 serve/return context. RESEARCH ONLY.
 * Never use future or same-day outcome summaries in a prematch card:
 * the archive includes ongoing events and some future-dated observations.
 * It cannot promote a fixture, change an FBIS model, or authorize a wager.
 */
const R2_KEY="tennis/canonical/current/latest/tennis_serve_index.json";
const key=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
let cache={loadedAt:0,value:null};
export async function loadTennisServeResearchIndex(archive,{now=Date.now()}={}){
 if(!archive?.get)return null;
 if(cache.value&&now-cache.loadedAt>=0&&now-cache.loadedAt<120000)return cache.value;
 try{
  const obj=await archive.get(R2_KEY);
  if(!obj)return null;
  const data=await obj.json();
  const built=Date.parse(data?.meta?.built||"");
  if(!Number.isFinite(built)||built>now+60000||now-built>36*3600000||
    !data?.players||!data?.canonicalRefresh||data.canonicalRefresh.bet!==false)return null;
  // Duplicate names are unsafe; the companion canonical player ID is not
  // always present on an independent ESPN research fixture.
  const byName=new Map();
  for(const [sourceId,player] of Object.entries(data.players)){
   const k=key(player?.name);
   if(!k)continue;
   if(byName.has(k))byName.set(k,null);
   else byName.set(k,{...player,sourceId});
  }
  const value={byName,builtAt:data.meta.built,source:"TENNISMYLIFE_CURRENT_CANONICAL_RESEARCH"};
  cache={loadedAt:now,value};
  return value;
 }catch{return null;}
}
export function selectTennisServeResearchPlayer(index,name,matchStart,{minMatches=5}={}){
 const player=index?.byName?.get(key(name));
 if(!player)return null;
 const match=Date.parse(matchStart||""),last=Date.parse(player.lastDate+"T00:00:00Z");
 const startDay=Number.isFinite(match)?new Date(match).toISOString().slice(0,10):null;
 // Strictly before fixture day; protects against same-match and future leakage.
 if(!startDay||!(player.lastDate<startDay)||!Number.isFinite(last)||
   match-last>120*86400000)return null;
 const n=Number(player?.surfaces?.Hard?.n||0);
 const hard=player?.surfaces?.Hard,rec=player?.recent;
 if(!Number.isFinite(n)||n<minMatches||!hard)return null;
 const safePct=x=>Number.isFinite(x)&&x>=0&&x<=1?Math.round(x*1000)/1000:null;
 const lastPlayed=Number(rec?.last10Played),lastWins=Number(rec?.last10Wins);
 return {player:name,source:"TENNISMYLIFE_CURRENT_CANONICAL_RESEARCH",
  sourcePlayerId:player.sourceId,observedAt:index.builtAt,
  asOfMatchDate:player.lastDate,hardCourtMatches:n,
  hardServePointsWon:safePct(hard.servePtsWonPct),
  hardReturnPointsWon:safePct(hard.retPtsWonPct),
  hardWinPct:safePct(hard.winPct),
  last10: Number.isInteger(lastWins)&&Number.isInteger(lastPlayed)&&lastPlayed>0&&
    lastWins>=0&&lastWins<=lastPlayed?{wins:lastWins,played:lastPlayed}:null,
  canQualify:false,canAuthorizeWager:false,canChangeProjection:false};
}
