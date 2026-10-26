/** Legacy historical SQL imports may run only while PRIMARY is CBB authority. */
import {createTopologyClient} from './lib/topologyFetch.mjs';
const {postTopology}=createTopologyClient();
const state=await postTopology('sport-authority-state',{sport:'cbb'});
if(state.mode!=='shadow'||state.binding!=='DB'||state.productIoUsesSportDb!==false)throw Error('CBB_LEGACY_IMPORT_REFUSED_AFTER_ACTIVATION');
console.log('CBB PRIMARY shadow import authority verified; no cutover permission');
