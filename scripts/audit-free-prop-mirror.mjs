/**
 * Explicitly offline, no-network/free-feed compatibility audit.
 * Accepts caller-supplied JSON and optional canonical games. It never persists
 * lines or state snapshots, makes no network requests, and grants no authority.
 *
 * Usage: node scripts/audit-free-prop-mirror.mjs mirror.json [canonical-games.json]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const NFL_SIX_MARKETS=Object.freeze({
  "Pass Yards":"passing_yards",
  "Pass Attempts":"passing_attempts",
  "Pass Completions":"completions",
  "Receiving Yards":"receiving_yards",
  "Receptions":"receptions",
  "Rush Yards":"rushing_yards",
});
const TEAM_ALIAS=Object.freeze({JAC:"JAX",LA:"LAR"});
const team=v=>TEAM_ALIAS[String(v??"").trim().toUpperCase()]??String(v??"").trim().toUpperCase();
const parsedTime=v=>v==null||v===""?null:(Number.isFinite(Date.parse(String(v)))?Date.parse(String(v)):null);
const identity=(at,home,away)=>{
  const ms=parsedTime(at),h=team(home),a=team(away);
  // Unordered team comparison is diagnostic only. It never confers identity authority.
  return ms!=null&&h&&a&&h!==a?ms+"|"+[h,a].sort().join("|"):null;
};

export function auditFreeNflMirror(feed,{canonicalGames=[],asOf=null}={}){
  if(!feed||feed.sport!=="NFL"||!Array.isArray(feed.props))throw new TypeError("NFL mirror props array required");
  if(!Array.isArray(canonicalGames))throw new TypeError("canonicalGames must be an array");
  const publishedAt=parsedTime(feed.scrapedAt);
  const observedAt=parsedTime(feed.collectionStatus?.providerFetchedAt);
  const now=parsedTime(asOf);
  const canonical=new Map();
  for(const game of canonicalGames){
    const key=identity(game.start,game.home_abbr,game.away_abbr);
    if(!key)continue;
    const matches=canonical.get(key)??new Set();
    matches.add(String(game.id));
    canonical.set(key,matches);
  }
  const byMarket=Object.fromEntries(Object.values(NFL_SIX_MARKETS).map(k=>[k,0]));
  const propsByGame=new Map();
  let sixMarketRows=0,missingSourceObservedAt=0,invalidGameStart=0;
  let sourceAfterPublication=0,duplicateProjectionIds=0,malformedLines=0;
  const seen=new Set(),sixPlayers=new Set();
  for(const prop of feed.props){
    const market=NFL_SIX_MARKETS[prop.stat];
    if(!market)continue;
    sixMarketRows++;byMarket[market]++;
    if(prop.playerId!=null)sixPlayers.add(String(prop.playerId));
    const projectionKey=String(prop.projectionId??"");
    if(!projectionKey||seen.has(projectionKey))duplicateProjectionIds++;
    else seen.add(projectionKey);
    const line=Number(prop.line);
    if(prop.line==null||String(prop.line).trim()===""||!Number.isFinite(line))malformedLines++;
    const rowObserved=parsedTime(prop.providerFetchedAt);
    if(rowObserved==null)missingSourceObservedAt++;
    if(publishedAt!=null&&rowObserved!=null&&rowObserved>publishedAt)sourceAfterPublication++;
    const key=identity(prop.startTimeIso,prop.teamCode,prop.opponentCode);
    if(!key)invalidGameStart++;
    const gameId=String(prop.gameId??"");
    const groupKey=gameId+"|"+(key??"invalid");
    const group=propsByGame.get(groupKey)??{providerGameId:gameId,key,count:0};
    group.count++;
    propsByGame.set(groupKey,group);
  }
  const identityCounts={unique:0,ambiguous:0,unmatched:0,invalid:0};
  const identityRows={unique:0,ambiguous:0,unmatched:0,invalid:0};
  for(const g of propsByGame.values()){
    const n=g.key?canonical.get(g.key)?.size??0:0;
    const status=!g.key?"invalid":n===1?"unique":n>1?"ambiguous":"unmatched";
    identityCounts[status]++;
    identityRows[status]+=g.count;
  }
  const sourceAgeHours=now!=null&&observedAt!=null?Math.round((now-observedAt)/36000)/100:null;
  return {
    source:"THIRD_PARTY_GITHUB_MIRROR",sport:"NFL",
    rightsReviewRequired:true,researchOnly:true,evidenceEligible:false,
    canQualify:false,canAuthorizeWager:false,canCreateStateSnapshots:false,
    dataPersisted:false,providerCostUsd:0,
    mirrorPublishedAt:feed.scrapedAt??null,
    providerObservedAt:feed.collectionStatus?.providerFetchedAt??null,
    sourceAgeHours,
    sourceTimeValid:observedAt!=null&&publishedAt!=null&&observedAt<=publishedAt,
    collectionStatusOk:feed.collectionStatus?.ok===true,
    sourceCount:Number(feed.collectionStatus?.sourceCount??0),
    publishedCount:feed.props.length,
    sixMarketRows,distinctSixMarketPlayers:sixPlayers.size,
    byMarket,gameCount:propsByGame.size,canonicalIdentityGameCounts:identityCounts,
    canonicalIdentityRowCounts:identityRows,
    missingSourceObservedAt,invalidGameStart,sourceAfterPublication,
    duplicateProjectionIds,malformedLines,
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2]||process.argv.length>4){
    process.stderr.write("Usage: node scripts/audit-free-prop-mirror.mjs mirror.json [canonical-games.json]\n");
    process.exitCode=2;
  }else{
    try{
      const feed=JSON.parse(readFileSync(process.argv[2],"utf8"));
      const canonicalGames=process.argv[3]?JSON.parse(readFileSync(process.argv[3],"utf8")):[];
      process.stdout.write(JSON.stringify(auditFreeNflMirror(feed,{canonicalGames,asOf:new Date().toISOString()}),null,2)+"\n");
    }catch(error){process.stderr.write(String(error.message)+"\n");process.exitCode=1;}
  }
}
