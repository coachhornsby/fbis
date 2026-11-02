// Offline canonical registry export for private Grok research staging.
import fs from 'node:fs';
import {listTeams} from '../functions/lib/teams.js';
import {CBB_RATING_ALIASES} from '../functions/lib/cbbProviderAliases.js';
const dir='artifacts/cbb-grok-integration';
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(`${dir}/identity-registry.json`,JSON.stringify({teams:listTeams('cbb'),aliases:CBB_RATING_ALIASES}));
