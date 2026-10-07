import { acquireTmlCanonical, classifyTmlFile } from '../tennis/sources/tennismylifeRemote.js';
import { reconcileObservations } from '../tennis/tennisObservationReconcile.js';
const pct=(a,b)=>b?+(100*a/b).toFixed(2):null;
const yearOf=o=>Number(String(o.matchDate||o.tournamentDate||'').slice(0,4));
const usable=o=>['winner','loser'].every(s=>['ace','df','svpt','firstIn','firstWon','secondWon','svGms','bpSaved','bpFaced'].every(f=>o[s]?.[f]!=null));
const summarize=(rows)=>{const players=new Set(),surface={},level={};let latest='',stats=0;for(const o of rows){players.add(o.winner.id||o.winner.name);players.add(o.loser.id||o.loser.name);surface[o.surface]=(surface[o.surface]||0)+1;level[o.level]=(level[o.level]||0)+1;if(o.matchDate>latest)latest=o.matchDate;if(usable(o))stats++;}return {matches:rows.length,players:players.size,serveStatUsablePct:pct(stats,rows.length),latest,surface,level};};
const {observations,manifest}=await acquireTmlCanonical();
const selected=observations.filter(o=>{const y=yearOf(o);return y>=2015&&y<=2026;});
const {observations:canonical,audit}=reconcileObservations(selected,{authority:{tennismylife:100}});
const byYear={};for(let y=2015;y<=2026;y++){const rows=canonical.filter(o=>yearOf(o)===y);byYear[y]=summarize(rows);}
const kinds={};for(const m of manifest){kinds[m.kind]??=[];kinds[m.kind].push(m);}
const out={generatedAt:new Date().toISOString(),source:'https://stats.tennismylife.org/api/data-files',manifest,kinds:Object.fromEntries(Object.entries(kinds).map(([k,v])=>[k,{files:v.length,observations:v.reduce((s,x)=>s+x.observations,0),latest:v.reduce((m,x)=>x.latest>m?x.latest:m,'')}])) ,reconciliation:audit,byYear,overall:summarize(canonical)};
console.log(JSON.stringify(out,null,2));
