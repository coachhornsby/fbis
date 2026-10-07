// TennisMyLife/Sackmann-shaped source adapter -> canonical FBIS observations.
// Field semantics are explicit; no missing statistic is synthesized.
import { canonicalMatchObservation } from '../canonicalMatchObservation.js';
function csv(line){const a=[];let s='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'){if(line[i+1]==='"'){s+='"';i++;}else q=false;}else s+=c;}else if(c==='"')q=true;else if(c===','){a.push(s);s='';}else s+=c;}a.push(s);return a;}
const val=(r,i,k)=>i[k]==null?null:r[i[k]];
const side=(r,i,identityPrefix,servicePrefix)=>({
 id:val(r,i,`${identityPrefix}_id`),name:val(r,i,`${identityPrefix}_name`),rank:val(r,i,`${identityPrefix}_rank`),
 ace:val(r,i,`${servicePrefix}_ace`),df:val(r,i,`${servicePrefix}_df`),svpt:val(r,i,`${servicePrefix}_svpt`),
 firstIn:val(r,i,`${servicePrefix}_1stIn`),firstWon:val(r,i,`${servicePrefix}_1stWon`),secondWon:val(r,i,`${servicePrefix}_2ndWon`),
 svGms:val(r,i,`${servicePrefix}_SvGms`),bpSaved:val(r,i,`${servicePrefix}_bpSaved`),bpFaced:val(r,i,`${servicePrefix}_bpFaced`)
});
export function parseTmlCsv(text,{source='tennismylife',sourceFile=null,sourceCommit=null,ingestedAt=null,sourceUpdatedAt=null}={}){
 const lines=String(text||'').split(/\r?\n/).filter(Boolean); if(!lines.length)return[];
 const h=csv(lines[0]).map(x=>x.trim()),i=Object.fromEntries(h.map((x,j)=>[x,j]));
 for(const k of ['tourney_name','tourney_date','winner_name','loser_name','score']) if(i[k]==null) throw new Error(`TML missing required column ${k}`);
 const out=[]; for(let x=1;x<lines.length;x++){const r=csv(lines[x]); if(r.length<h.length-2)continue;
   const tid=val(r,i,'tourney_id'),mn=val(r,i,'match_num'),date=val(r,i,'tourney_date');
   out.push(canonicalMatchObservation({source,sourceMatchId:[tid,date,mn,val(r,i,'winner_id'),val(r,i,'loser_id')].filter(v=>v!=null&&v!=='').join(':'),
    tournamentId:tid,tournament:val(r,i,'tourney_name'),tournamentDate:date,matchDate:date,surface:val(r,i,'surface'),level:val(r,i,'tourney_level'),
    round:val(r,i,'round'),bestOf:val(r,i,'best_of'),score:val(r,i,'score'),winner:side(r,i,'winner','w'),loser:side(r,i,'loser','l'),
    observedAt:/^\d{8}$/.test(String(date))?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`:date, effectiveAt:null,ingestedAt,sourceUpdatedAt,
    provenance:{provider:'TennisMyLife',sourceFile,sourceCommit,schema:'TML/Sackmann-compatible',matchDatePrecision:'tournament_start_date'},transformations:['explicit field mapping only']}));
 } return out;
}
export default {parseTmlCsv};
