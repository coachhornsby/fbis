import {SPORT_DATABASES,deployedSportDbMode,hydrateCutoverApprovals} from './databaseTopology.js';
/** Load existing CORE approvals into each collector request. Never create a grant or fall back after cutover. */
export async function collectionOwnerContext(env={}){
 if(!Object.keys(SPORT_DATABASES).some(s=>deployedSportDbMode(env,s)==='sport'))return env;
 const scoped={...env,__fbisCutoverApprovals:new Map()};
 await hydrateCutoverApprovals(scoped);
 // A failed/revoked/missing CORE read leaves an empty map. Strict routing then
 // remains unavailable through productSportDbHandle, rather than writing PRIMARY.
 return scoped;
}
