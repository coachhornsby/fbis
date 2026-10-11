// Synthetic local Wrangler integration harness; never a production entrypoint.
import forwardSchema from '../../docs/sql/cfb-forward-evidence-candidate.sql';
import {appendForwardShadow} from '../../functions/lib/cfbForwardStore.js';
import schema from '../../docs/sql/cfb-postgame-operational-candidate.sql';
import {processCfbPostgamePilot} from '../../functions/lib/cfbPostgamePilot.js';
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 try {
  if(path==='/init') { await env.DB.batch(schema.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));return Response.json({initialized:true,scope:'LOCAL_ONLY'}); }
  if(path==='/forward-init'){await env.DB.batch(forwardSchema.replace(/^--.*$/gm,'').split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));return Response.json({initialized:true});}
  if(path==='/forward'){return Response.json(await appendForwardShadow({db:env.DB,databaseId:'isolated-workerd',mode:'nonproduction',snapshot:await request.json()}));}
  if(path==='/forward-inspect'){return Response.json(await env.DB.prepare('SELECT id,body_json FROM cfb_forward_snapshots').all());}
  if(path==='/inspect') {
   const cards=await env.DB.prepare('SELECT c.team_id,v.body_json FROM cfb_postgame_card_current c JOIN cfb_postgame_card_versions v ON v.id=c.version_id').all();
   const jobs=await env.DB.prepare('SELECT * FROM cfb_postgame_jobs').all();return Response.json({cards:cards.results,jobs:jobs.results});
  }
  const {payload,at,rawBody}=await request.json();
  return Response.json(await processCfbPostgamePilot({db:env.DB,archive:env.ARCHIVE,databaseId:'00000000-0000-4000-8000-000000000001',mode:'nonproduction',payload,at,rawBody,
   identityVerifier:async p=>({verified:p.game_id==='g1'&&p.teams.every(t=>['h','a'].includes(t.team_id)),fbs_involving:true})}));
 } catch(e){return Response.json({error:e.message},{status:400});}
}};
