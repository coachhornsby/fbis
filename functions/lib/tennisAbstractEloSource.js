/**
 * Current Tennis Abstract Elo ratings: SEPARATE research feed, not 2026 match results.
 * Source: https://www.tennisabstract.com/reports/{atp,wta}_elo_ratings.html
 * The archive match-history source remains immutable. Do not silently merge
 * these ratings into official players, PURE projections, public licensing,
 * qualification, or wagering authority.
 */
const ORIGIN = 'https://www.tennisabstract.com/reports';
export const TENNIS_ABSTRACT_ELO_SOURCE = 'TENNIS_ABSTRACT_LIVE_ELO_RESEARCH';
export const tennisAbstractEloUrl=tour=>`${ORIGIN}/${tour}_elo_ratings.html`;
export const playerKey=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const entities={'&nbsp;':' ','&#160;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'};
const stripHtml=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/&(?:nbsp|amp|quot|apos|lt|gt|#160|#39);/gi,m=>entities[m.toLowerCase()]||m)
 .replace(/\s+/g,' ').trim();
const optionalFloat=x=>{const n=Number(x);return x && Number.isFinite(n)?n:null;};
const elo=x=>{const v=optionalFloat(x);return v!==null&&v>=900&&v<=3000?v:null;};
const safeRank=x=>{const v=Number(x);return Number.isSafeInteger(v)&&v>=1&&v<=10000?v:null;};
const sourceDate=html=>{
 const m=html.match(/Last\s+update\s*:\s*(\d{4}-\d{2}-\d{2})/i);
 return m?m[1]:null;
};
export function parseTennisAbstractElo(html,tour,{now=new Date()}={}){
 if(!['atp','wta'].includes(tour)||typeof html!=='string'||html.length>2_000_000||
   !new RegExp('Tennis Abstract:\\s*'+tour+'\\s+Elo Ratings','i').test(html))throw Error('ELO_SOURCE_TITLE_INVALID');
 const date=sourceDate(html),stamp=Date.parse((date||'')+'T00:00:00Z');
 if(!Number.isFinite(stamp)||stamp>+now+86400000||+now-stamp>21*86400000)
  throw Error('ELO_SOURCE_REPORT_DATE_STALE_OR_INVALID');
 const table=html.match(/<table\b[^>]*id=["']reportable["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
 const tbody=table?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
 if(!tbody)throw Error('ELO_SOURCE_TABLE_CONTRACT_CHANGED');
 const seen=new Set(),rows=[];
 for(const item of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...item[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>stripHtml(m[1]));
  if(cells.length!==17)throw Error('ELO_SOURCE_COLUMNS_CHANGED');
  const rank=safeRank(cells[0]),name=cells[1],overall=elo(cells[3]);
  const key=playerKey(name),hard=elo(cells[6]),clay=elo(cells[8]),grass=elo(cells[10]);
  if(!rank||!key||key.split(' ').length<2||!overall||seen.has(key))throw Error('ELO_SOURCE_PLAYER_INVALID_OR_DUPLICATE');
  seen.add(key);
  rows.push({tour,reportDate:date,playerName:name,playerKey:key,eloRank:rank,
   overallElo:overall,hardElo:hard,clayElo:clay,grassElo:grass,
   officialRank:safeRank(cells[15])});
 }
 if(rows.length<100||rows.length>3000||rows[0].eloRank!==1||rows.some((r,i)=>i>0&&r.eloRank<rows[i-1].eloRank))
  throw Error('ELO_SOURCE_COVERAGE_UNVERIFIED');
 return {tour,reportDate:date,url:tennisAbstractEloUrl(tour),players:rows,
  source:TENNIS_ABSTRACT_ELO_SOURCE,researchOnly:true,canAuthorizeWager:false};
}
const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))]
 .map(v=>v.toString(16).padStart(2,'0')).join('');
export async function fetchTennisAbstractElo(tour,{fetchImpl=fetch,now=new Date()}={}){
 if(!['atp','wta'].includes(tour))throw Error('ELO_TOUR_INVALID');
 const url=tennisAbstractEloUrl(tour);
 const response=await fetchImpl(url,{headers:{accept:'text/html'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('ELO_PROVIDER_HTTP_'+response.status);
 const html=await response.text(),parsed=parseTennisAbstractElo(html,tour,{now});
 return {...parsed,sourceHash:await hash(html),retrievedAt:now.toISOString()};
}
export async function persistTennisAbstractElo(db,record){
 if(!db?.prepare||!record?.players?.length||!record?.sourceHash)throw Error('ELO_STORAGE_INPUT_INVALID');
 const prior=await db.prepare('SELECT player_count FROM tennis_abstract_elo_runs WHERE tour=? AND report_date=? AND source_hash=?')
  .bind(record.tour,record.reportDate,record.sourceHash).first();
 if(prior)return {tour:record.tour,reportDate:record.reportDate,players:Number(prior.player_count),unchanged:true,wrote:0};
 // All players are inserted with an uncommitted source hash. The run receipt
 // is published only after every batch finishes. Consumers join runs to
 // ignore a partially written source and never report it as complete.
 let wrote=0;
 for(let index=0;index<record.players.length;index+=40){
  const items=record.players.slice(index,index+40);
  const queries=items.map(p=>db.prepare(`INSERT OR IGNORE INTO tennis_abstract_elo_players(
    tour,report_date,source_hash,player_key,player_name,elo_rank,overall_elo,hard_elo,clay_elo,grass_elo,
    official_rank_display,source_url,retrieved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(record.tour,record.reportDate,record.sourceHash,p.playerKey,p.playerName,p.eloRank,p.overallElo,
    p.hardElo,p.clayElo,p.grassElo,p.officialRank,record.url,record.retrievedAt));
  const result=await db.batch(queries);
  if(!Array.isArray(result)||result.some(r=>r?.success===false))throw Error('ELO_PARTIAL_PLAYER_BATCH');
  wrote+=items.length;
 }
 const check=await db.prepare('SELECT COUNT(*) n FROM tennis_abstract_elo_players WHERE tour=? AND report_date=? AND source_hash=?')
  .bind(record.tour,record.reportDate,record.sourceHash).first();
 if(Number(check?.n)!==record.players.length)throw Error('ELO_ROW_PARITY_FAILED');
 await db.prepare(`INSERT OR IGNORE INTO tennis_abstract_elo_runs
  (tour,report_date,source_hash,source_url,player_count,retrieved_at,research_only,can_authorize_wager)
  VALUES(?,?,?,?,?,?,1,0)`).bind(record.tour,record.reportDate,record.sourceHash,record.url,
  record.players.length,record.retrievedAt).run();
 return {tour:record.tour,reportDate:record.reportDate,players:record.players.length,
  unchanged:false,wrote,sourceHash:record.sourceHash};
}
