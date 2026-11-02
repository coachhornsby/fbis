import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {cp,rename,writeFile} from 'node:fs/promises';
export default defineConfig({plugins:[react(),{name:'static-board-publication',async closeBundle(){
  await writeFile('deploy/board/dist/_routes.json',JSON.stringify({version:1,include:['/operator/cbb-capture'],exclude:[]}));
  await rename('deploy/board/dist/publication.html','deploy/board/dist/index.html');
  await cp('deploy/board/snapshots','deploy/board/dist/board-data',{recursive:true});
  await writeFile('deploy/board/dist/api-unavailable.json',JSON.stringify({ok:false,error:'This service remains paused during the board restart.',canAuthorizeWager:false}));
  await writeFile('deploy/board/dist/_redirects','/api/* /api-unavailable.json 200\n');
  await writeFile('deploy/board/dist/_headers','/board-data/*\n  Cache-Control: public, max-age=60\n/api-unavailable.json\n  Cache-Control: no-store\n');
}}],build:{outDir:'deploy/board/dist',emptyOutDir:true,rollupOptions:{input:'publication.html'}}});
