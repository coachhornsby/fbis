// Research identity corroboration against Sackmann player-master CSVs.
// Source IDs are NOT ATP/WTA official IDs, and these findings never auto-link.
import {normalizeName} from './tennis-lowtier-source-audit.mjs';
const strictDate=v=>{
 const s=String(v??'').replace(/-/g,'');
 if(!/^[0-9]{8}$/.test(s)||s.slice(4,6)==='00'||s.slice(6,8)==='00')return null;
 const d=new Date(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T00:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10).replace(/-/g,'')===s?s:null;
};
const ioc=v=>String(v??'').trim().toUpperCase();
export function masterPlayerIndex(rows){
 const entries=new Map();const ambiguous=new Set();
 for(const r of rows){
  const id=String(r.player_id??'').trim();
  if(!/^[0-9]+$/.test(id))continue;
  const item={name:normalizeName([r.name_first,r.name_last].filter(Boolean).join(' ')),
    dob:strictDate(r.dob),country:ioc(r.ioc)};
  if(!item.name)continue;
  if(entries.has(id)){
   const prev=entries.get(id);
   if(prev.name!==item.name||prev.dob!==item.dob||prev.country!==item.country)ambiguous.add(id);
  }else entries.set(id,item);
 }
 return {entries,ambiguous};
}
export function evaluateIdentityEvidence(player,canonical,master){
 const ids=[...new Set((player.candidateSourceIds||[]).map(String))];
 const base={sourcePlayerIds:ids,identityEvidence:'UNVERIFIED',canAutoLink:false,
  canQualify:false,canAuthorizeWager:false};
 if(ids.length!==1)return {...base,reason:ids.length===0?'NO_SOURCE_ID':'MULTIPLE_SOURCE_IDS'};
 const id=ids[0];
 if(master.ambiguous.has(id))return {...base,reason:'MASTER_SOURCE_ID_COLLISION'};
 const source=master.entries.get(id);
 if(!source)return {...base,reason:'SOURCE_MASTER_ID_MISSING'};
 const normalized=normalizeName(player.playerName);
 if(!normalized||source.name!==normalized)return {...base,reason:'MASTER_NAME_MISMATCH'};
 const cdob=strictDate(canonical.canonicalDob),ccountry=ioc(canonical.canonicalCountry);
 if(!cdob||!ccountry)return {...base,reason:'CANONICAL_BIOGRAPHY_MISSING'};
 if(!source.dob||!source.country)return {...base,reason:'SOURCE_BIOGRAPHY_MISSING'};
 if(source.dob!==cdob)return {...base,reason:'BIRTHDATE_CONFLICT'};
 if(source.country!==ccountry)return {...base,reason:'COUNTRY_CONFLICT'};
 return {...base,identityEvidence:'SOURCE_ID_NAME_DOB_COUNTRY_CONCORDANT',reason:null,
  evidenceScope:'NONCOMMERCIAL_RESEARCH_ONLY'};
}
