/**
 * Validated Tennis Abstract current Elo snapshots for prematch RESEARCH ONLY.
 * Never a PURE calibrated FBIS model, bookmaker market probability, or bet authorization.
 * Prefer the newest COMPLETE, research-only, immutable source receipt.
 */
import {tennisKey} from './tennisPlayerBank.js';

export const CURRENT_TENNIS_ELO_SOURCE='TENNIS_ABSTRACT_CURRENT_ELO_RESEARCH_ONLY';
const HASH=/^[a-f0-9]{64}$/;
const MAX_AGE_DAYS=21;
const validRating=v=>v!=null && v!=='' && Number.isFinite(Number(v)) &&
  Number(v)>=900 && Number(v)<=3000;
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&
  Number.isFinite(Date.parse(String(v)+'T00:00:00Z'));
const finiteTime=v=>Number.isFinite(Date.parse(String(v||'')));
const day=v=>new Date(v).toISOString().slice(0,10);

/** Read source receipt separately from player rows, so partial source writes are ignored.
 * No mutable "current" flag can impersonate a completed published report.
 */
export async function loadValidatedCurrentTennisElo(db,{now=new Date()}={}){
 if(!db?.prepare)return {ok:false,reason:'D1_UNAVAILABLE',snapshots:new Map(),players:new Map()};
 const nowMs=+now;
 if(!Number.isFinite(nowMs))return {ok:false,reason:'NOW_INVALID',snapshots:new Map(),players:new Map()};
 const snapshots=new Map(),players=new Map();
 const receipts=(await db.prepare(`WITH ranked AS (
   SELECT tour,report_date,source_hash,source_url,source_label,player_count,retrieved_at,
          research_only,can_authorize_wager,
          ROW_NUMBER() OVER(PARTITION BY tour ORDER BY report_date DESC,retrieved_at DESC,source_hash DESC) rn
   FROM tennis_abstract_elo_runs
   WHERE research_only=1 AND can_authorize_wager=0
     AND julianday(retrieved_at)<=julianday(?)
     AND julianday(report_date)<=julianday(?)
 ) SELECT * FROM ranked WHERE rn=1 ORDER BY tour`)
  .bind(now.toISOString(),now.toISOString()).all()).results||[];
 for(const row of receipts){
   const reportMs=Date.parse(String(row.report_date)+'T00:00:00Z');
   const retrievedMs=Date.parse(row.retrieved_at||'');
   if(!['atp','wta'].includes(row.tour)||!validDate(row.report_date)||
      !HASH.test(String(row.source_hash||''))||!(Number(row.player_count)>=100&&Number(row.player_count)<=3000)||
      !Number.isFinite(retrievedMs)||retrievedMs>nowMs||
      reportMs>nowMs||nowMs-reportMs>MAX_AGE_DAYS*86400000||
      row.research_only!==1||row.can_authorize_wager!==0)continue;
   // Verify total rows against immutable receipt before accepting any players.
   const count=await db.prepare(`SELECT COUNT(*) n FROM tennis_abstract_elo_players
     WHERE tour=? AND report_date=? AND source_hash=?`)
    .bind(row.tour,row.report_date,row.source_hash).first();
   if(Number(count?.n)!==Number(row.player_count))continue;
   snapshots.set(row.tour,row);
 }
 return {ok:snapshots.size>0,reason:snapshots.size?'VERIFIED_COMPLETE_SOURCE':'NO_COMPLETE_RECENT_SOURCE',
   snapshots,players};
}

/** Fetch just the canonical full-name keys present on today's exchange cards. */
export async function loadCurrentTennisEloPlayers(db,source,keysByTour){
 for(const [tour,receipt] of source.snapshots){
   const keys=[...new Set(keysByTour.get(tour)||[])].filter(Boolean);
   for(let i=0;i<keys.length;i+=35){
     const batch=keys.slice(i,i+35);
     const query=`SELECT player_key,player_name,elo_rank,overall_elo,hard_elo,clay_elo,
       grass_elo,report_date,source_hash,retrieved_at FROM tennis_abstract_elo_players
       WHERE tour=? AND report_date=? AND source_hash=?
         AND player_key IN (${batch.map(()=>'?').join(',')})`;
     const rows=(await db.prepare(query)
       .bind(tour,receipt.report_date,receipt.source_hash,...batch).all()).results||[];
     const byKey=new Map();
     for(const row of rows){
       const k=tennisKey(row.player_name);
       if(row.player_key!==k||!batch.includes(k)||byKey.has(k)||
          !validRating(row.overall_elo)||row.report_date!==receipt.report_date||
          row.source_hash!==receipt.source_hash||!finiteTime(row.retrieved_at)||
          Date.parse(row.retrieved_at)>Date.parse(receipt.retrieved_at)+60000){
         if(k)byKey.set(k,null); // fail closed on duplicate or malformed identity
         continue;
       }
       byKey.set(k,row);
     }
     for(const [key,row] of byKey){
       if(row)source.players.set(tour+'|'+key,{...row,tour,
         source:CURRENT_TENNIS_ELO_SOURCE,sourceUrl:receipt.source_url,
         reportDate:receipt.report_date,retrievedAt:receipt.retrieved_at});
     }
   }
 }
 return source;
}

/** A source-validated rating is NOT a validated winning-probability model. */
export function currentTennisEloEstimate(home,away,{start,now=new Date(),surface=null}={}){
 const startMs=Date.parse(start||''),nowMs=+now;
 if(!Number.isFinite(startMs)||!Number.isFinite(nowMs))return null;
 const cutoff=Math.min(startMs,nowMs),startDay=day(startMs);
 const valid=p=>p?.source===CURRENT_TENNIS_ELO_SOURCE&&
   validDate(p.reportDate)&&p.reportDate<startDay&&
   finiteTime(p.retrievedAt)&&Date.parse(p.retrievedAt)<=cutoff&&
   validRating(p.overall_elo);
 if(!valid(home)||!valid(away)||home.tour!==away.tour||home.player_key===away.player_key)return null;
 const s=['hard','clay','grass'].includes(String(surface).toLowerCase())?String(surface).toLowerCase():null;
 const col=s?s+'_elo':'overall_elo';
 // Both players must have the SAME rated context; never mix surface Elo and overall Elo.
 if(!validRating(home[col])||!validRating(away[col]))return null;
 const p=1/(1+10**((Number(away[col])-Number(home[col]))/400));
 return {player1WinProb:Math.round(p*1000)/1000,
   player2WinProb:Math.round((1-p)*1000)/1000,
   source:CURRENT_TENNIS_ELO_SOURCE,surface:s,
   observations:[home,away].map(x=>({elo:Number(x[col]),source:x.source,
     reportDate:x.reportDate,sourceUrl:x.sourceUrl,lastMatchDate:null})),
   reportDate:home.reportDate===away.reportDate?home.reportDate:null,
   method:'UNADJUSTED_ELO_LOGISTIC_RESEARCH',uncertainty:
     s?'UNVALIDATED_WIN_PROBABILITY_MODEL; SURFACE_ELO_ONLY':
       'SURFACE_UNVERIFIED; OVERALL_ELO_ONLY; UNVALIDATED_WIN_PROBABILITY_MODEL',
   marketInformed:false,canQualify:false,canAuthorizeWager:false,modelAuthorityChanged:false};
}
