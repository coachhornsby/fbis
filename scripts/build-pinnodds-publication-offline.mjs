// Compile the actual publication UI without collecting scores, copying private
// inputs, publishing artifacts, or deploying. Suitable for PR-only CI.
import {build} from 'vite';
import config from '../vite.publication.config.js';
await build({...config,configFile:false,
 plugins:config.plugins.filter(plugin=>plugin.name!=='static-board-publication'),
 build:{...config.build,outDir:'artifacts/pinnodds-static-build',emptyOutDir:true}});
