import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cp,rename,writeFile,readFile,readdir} from 'node:fs/promises';
import {attachPersistedPinnoddsReference} from './src/lib/pinnoddsPersistedReference.js';
export default defineConfig({plugins:[react(),{name:'static-board-publication',async closeBundle(){
  await rename('deploy/board/dist/publication.html','deploy/board/dist/index.html');
  await cp('deploy/board/snapshots','deploy/board/dist/board-data',{recursive:true});
  // Retained sanitized direct observations survive board rebuilds without a pull.
  for(const file of await readdir('data/public/pinnodds').catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
   if(!/^\d{4}-\d{2}-\d{2}\.json$/.test(file))continue;
   const target='deploy/board/dist/board-data/'+file;
   let existing;try{existing=JSON.parse(await readFile(target,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
   const packet=JSON.parse(await readFile('data/public/pinnodds/'+file,'utf8'));
   await writeFile(target,JSON.stringify(attachPersistedPinnoddsReference(existing,packet)));
  }
  await cp('data/public/cbb-readiness','deploy/board/dist/board-data/cbb-readiness',{recursive:true});
  await writeFile('deploy/board/dist/api-unavailable.json',JSON.stringify({ok:false,error:'This service remains paused during the board restart.',canAuthorizeWager:false}));
  await writeFile('deploy/board/dist/_redirects','/api/* /api-unavailable.json 200\n');
  await writeFile('deploy/board/dist/_headers','/board-data/*\n  Cache-Control: public, max-age=60\n/api-unavailable.json\n  Cache-Control: no-store\n');
}}],build:{outDir:'deploy/board/dist',emptyOutDir:true,rollupOptions:{input:'publication.html'}}});
