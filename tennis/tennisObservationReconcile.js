// Cross-source reconciliation for canonical Tennis observations.
import { canonicalIdentity } from './canonicalMatchObservation.js';

const STAT=['ace','df','svpt','firstIn','firstWon','secondWon','svGms','bpSaved','bpFaced'];
const MATCH_FIELDS=['tournamentDate','matchDate','surface','level','round','bestOf','score'];
const norm=(v)=>v==null?null:String(v).trim();
function compareField(audit,key,vals){
  const observed=vals.filter(v=>v!=null&&v!=='');
  if(observed.length<2) return;
  audit.fieldComparisons++;
  audit.byField[key]??={compared:0,disagreed:0};
  audit.byField[key].compared++;
  if(new Set(observed.map(v=>String(v))).size>1){
    audit.fieldDisagreements++;
    audit.byField[key].disagreed++;
  }
}
export function reconcileObservations(observations,{authority={}}={}){
  const groups=new Map();
  for(const o of observations){
    const k=canonicalIdentity(o);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(o);
  }
  const audit={
    input:observations.length,canonical:0,duplicateObservations:0,exactDuplicates:0,
    crossSourceDuplicates:0,identityCollisions:0,fieldComparisons:0,fieldDisagreements:0,byField:{}
  },out=[];
  for(const [identity,g] of groups){
    audit.duplicateObservations+=Math.max(0,g.length-1);
    const sources=new Set(g.map(x=>x.source));
    if(sources.size>1) audit.crossSourceDuplicates+=g.length-1;
    const seenSourceIds=new Set();
    for(const x of g){
      const k=`${x.source}|${x.sourceMatchId}`;
      if(seenSourceIds.has(k)) audit.exactDuplicates++;
      seenSourceIds.add(k);
    }
    const idPairs=new Set(g.map(x=>[x.winner?.id||'',x.loser?.id||''].sort().join('|')));
    if(idPairs.size>1) audit.identityCollisions++;

    const sorted=g.slice().sort((a,b)=>(authority[b.source]||0)-(authority[a.source]||0));
    const z=structuredClone(sorted[0]);
    z.provenance={...z.provenance,contributors:sorted.map(x=>({source:x.source,sourceMatchId:x.sourceMatchId}))};

    for(const f of MATCH_FIELDS) compareField(audit,`match.${f}`,sorted.map(x=>norm(x[f])));
    for(const side of ['winner','loser']){
      compareField(audit,`${side}.id`,sorted.map(x=>norm(x[side]?.id)));
      compareField(audit,`${side}.rank`,sorted.map(x=>x[side]?.rank));
      for(const f of STAT){
        compareField(audit,`${side}.${f}`,sorted.map(x=>x[side]?.[f]));
        if(z[side][f]==null){
          const donor=sorted.find(x=>x[side]?.[f]!=null);
          if(donor){
            z[side][f]=donor[side][f];
            z.transformations.push(`filled ${side}.${f} from observed ${donor.source}`);
          }
        }
      }
    }
    out.push(z);
  }
  audit.canonical=out.length;
  audit.disagreementRate=audit.fieldComparisons?audit.fieldDisagreements/audit.fieldComparisons:0;
  return {observations:out,audit};
}
export default {reconcileObservations};
