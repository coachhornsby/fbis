import {onRequestPost as collect,onRequestGet} from '../../../../functions/api/kalshi-collector-internal.js';
export {onRequestGet};
// Same existing encrypted credentials and account-wide admission. No D1 binding.
export function onRequestPost(context){
 return collect({...context,env:{...context.env,ARCHIVE:context.env.FBIS_PRIVATE_CBB}});
}
