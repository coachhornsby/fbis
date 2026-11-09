import {renderPinnoddsReference} from './pinnoddsStaticReference.js';
// A checked-in sanitized snapshot is a retained observation, not a new fetch.
export function attachPersistedPinnoddsReference(board,packet,{now=Date.now()}={}){
 if(!Array.isArray(board?.games)||packet?.retainLastObserved!==true||packet.contract!=='fbis-pinnodds-public-reference-v1')throw Error('PINNODDS_PERSISTED_REFERENCE_INVALID');
 const old=board.pinnoddsStaticReference;
 const selected=old&&Date.parse(old.capturedAt)>Date.parse(packet.capturedAt)?old:packet;
 return {...board,pinnoddsStaticReference:selected,games:board.games.map(g=>renderPinnoddsReference(g,selected,{now}))};
}
