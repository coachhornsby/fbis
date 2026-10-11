import {loadSdvIntelligence} from '../lib/cfbSdvIntelligence.js';
export async function onRequestGet(context){
  try {return Response.json(await loadSdvIntelligence({caches:globalThis.caches?.default}),{headers:{'Cache-Control':'public, max-age=300'}});}
  catch(error){return Response.json({ok:false,teams:[],conferences:[],error:String(error?.message||error),canQualify:false,canAuthorizeWager:false},{status:503,headers:{'Cache-Control':'public, max-age=60'}});}
}
