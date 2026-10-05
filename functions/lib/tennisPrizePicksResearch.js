import { simulateTennisMatch, tennisPlayerProjectionRows } from "./tennisFbisV1.js";

const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clean=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const validImage=u=>/^https?:\/\//i.test(String(u||"").trim())&&!/\/images\/teams\//i.test(String(u||""));

function rankToElo(rank){
  const r=Math.max(1,finite(rank)||250);
  return Math.max(1350,Math.min(2100,2050-125*Math.log(r)));
}
function defaults(tour){
  return tour==="wta"
    ? {servePointWinPct:.59,returnPointWinPct:.41,aceRate:.045,doubleFaultRate:.045}
    : {servePointWinPct:.635,returnPointWinPct:.365,aceRate:.075,doubleFaultRate:.035};
}
function rankingRows(payload,tour){
  const out=[];
  for(const block of payload?.rankings||[]){
    for(const row of block?.ranks||[]){
      const a=row?.athlete||{};
      if(!a?.displayName) continue;
      out.push({
        tour,
        name:a.displayName,
        rank:finite(row.current),
        points:finite(row.points),
        espnId:a.id?String(a.id):null,
        headshot:validImage(a.headshot)?a.headshot:null,
      });
    }
  }
  return out;
}

export async function fetchEspnTennisRankings(fetchImpl=fetch){
  const urls={
    atp:"https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings?region=us&lang=en",
    wta:"https://site.web.api.espn.com/apis/site/v2/sports/tennis/wta/rankings?region=us&lang=en",
  };
  const rows=[];
  for(const [tour,url] of Object.entries(urls)){
    try{
      const res=await fetchImpl(url,{headers:{accept:"application/json"}});
      if(!res?.ok) continue;
      rows.push(...rankingRows(await res.json(),tour));
    }catch{}
  }
  const byName=new Map(rows.map(r=>[clean(r.name),r]));
  return {rows,byName,source:"ESPN_TENNIS_RANKINGS"};
}

function latestHeadshots(rows=[]){
  const map=new Map();
  for(const row of rows){
    const name=clean(row.player_name||row.playerName);
    const url=row.player_headshot_url||row.imageUrl;
    if(name&&!map.has(name)&&validImage(url)) map.set(name,String(url));
  }
  return map;
}

function profile(name,rankings,headshots){
  const key=clean(name);
  const rank=rankings?.byName?.get(key)||null;
  const tour=rank?.tour||"atp";
  const base=defaults(tour);
  return {
    id:rank?.espnId||key,
    name,
    tour,
    rank:rank?.rank??null,
    elo:rankToElo(rank?.rank),
    surfaceElo:{hard:rankToElo(rank?.rank),clay:rankToElo(rank?.rank),grass:rankToElo(rank?.rank)},
    headshot:headshots.get(key)||rank?.headshot||null,
    ...base,
  };
}

export function canonicalTennisEventId(row={}){
  const gid=String(row.game_id||row.providerGameId||"").trim();
  if(gid)return `tennis:pp:${gid}`;
  return `tennis:pp:${clean(row.player_name||row.playerName)}:${clean(row.opponent)}:${String(row.start_time||"").slice(0,16)}`;
}

export function buildTennisResearchBoardRows(rawRows=[],rankings={byName:new Map()}){
  const headshots=latestHeadshots(rawRows);
  const byGame=new Map();
  for(const row of rawRows){
    const game=String(row.game_id||row.providerGameId||"").trim();
    const player=String(row.player_name||row.playerName||"").trim();
    const opponent=String(row.opponent||"").trim();
    if(!game||!player||!opponent) continue;
    if(player.includes("/")||opponent.includes("/")) continue; // doubles need a separate pair-strength model
    if(!byGame.has(game))byGame.set(game,[]);
    byGame.get(game).push(row);
  }

  const out=[];
  for(const [gameId,rows] of byGame){
    const first=rows[0];
    const p1=profile(first.player_name,rankings,headshots);
    const p2=profile(first.opponent,rankings,headshots);
    const eventId=canonicalTennisEventId(first);
    const game={
      id:eventId,
      sport:"tennis",
      start:first.start_time||null,
      surface:"hard",
      bestOf:3,
      player1:p1,
      player2:p2,
    };
    const projection=simulateTennisMatch(game,{simulations:1500},{seed:eventId});
    const lineInputs=rows.map(r=>({
      playerId:clean(r.player_name)===clean(p1.name)?p1.id:p2.id,
      market:r.canonical_market,
      line:r.line,
    }));
    const projections=tennisPlayerProjectionRows(game,projection,lineInputs);
    const projMap=new Map(projections.map(p=>[`${clean(p.playerName)}|${p.market}`,p]));

    for(const row of rows){
      const key=`${clean(row.player_name)}|${row.canonical_market}`;
      const pr=projMap.get(key)||null;
      const image=headshots.get(clean(row.player_name))||rankings?.byName?.get(clean(row.player_name))?.headshot||null;
      if(!validImage(image)) continue;
      out.push({
        provider:"PRIZEPICKS_APIFY",
        providerGameId:gameId,
        fbisEventId:eventId,
        providerPlayerId:row.player_id||null,
        fbisPlayerId:clean(row.player_name)===clean(p1.name)?p1.id:p2.id,
        playerName:row.player_name,
        team:row.player_name,
        position:"Player",
        imageUrl:image,
        imageSource:headshots.get(clean(row.player_name))?"PRIZEPICKS_FEED":"ESPN_TENNIS_RANKINGS",
        sport:"tennis",
        market:row.stat_type,
        marketCanonical:row.canonical_market,
        period:row.duration||"event",
        book:"PrizePicks",
        side:row.candidate_side||null,
        line:finite(row.line),
        price:null,
        overOdds:null,
        underOdds:null,
        sourceObservedAt:row.observed_at||null,
        collectedAt:row.collected_at||null,
        gameIdentityConfidence:"EXACT_PROVIDER_GAME",
        playerIdentityConfidence:"HIGH",
        marketComplete:row.line!=null,
        fbisProjection:pr?.fbisProjection??null,
        fbisSigma:pr?.fbisSigma??null,
        probabilityOver:pr?.probabilityOver??null,
        probabilityUnder:pr?.probabilityUnder??null,
        modelSource:"TENNIS_POINT_LEVEL_SIM_RANK_PRIOR",
        modelVersion:projection.modelVersion,
        modelMaturity:"RESEARCH",
        modelAuthorized:false,
        decisionEligible:false,
        canQualify:false,
        canAuthorizeWager:false,
        eligibleForCard:false,
        propGate:"RESEARCH",
        gateReason:"tennis_rank_prior_requires_historical_walk_forward_validation",
        opponent:first.player_name===row.player_name?first.opponent:first.player_name,
        researchContext:{
          playerRank:rankings?.byName?.get(clean(row.player_name))?.rank??null,
          opponentRank:rankings?.byName?.get(clean(row.opponent))?.rank??null,
          surfaceAssumption:"hard-neutral",
          dataQuality:(rankings?.byName?.has(clean(row.player_name))&&rankings?.byName?.has(clean(row.opponent)))?"RANKED":"SPARSE",
        },
      });
    }
  }
  return out;
}
