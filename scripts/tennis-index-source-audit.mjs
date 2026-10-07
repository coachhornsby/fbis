#!/usr/bin/env node
import fs from 'node:fs';

const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.replace(/^--/,''),true]:[x.slice(2,i),x.slice(i+1)]}));
const file=args.file, dataClass=args.class, year=Number(args.year), minServe=Number(args.minServe??0.80);
if(!file||!dataClass||!year) throw new Error('usage: --file=... --class=tour|challenger --year=YYYY [--minServe=0.80]');

const txt=fs.readFileSync(file,'utf8');
function split(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else if(c==='"')q=true;else if(c===','){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out;}
const lines=txt.split(/\r?\n/).filter((x,i,a)=>x.length||i<a.length-1);
const result={file,dataClass,year,bytes:Buffer.byteLength(txt),rows:0,columns:0,usableServeRows:0,usableServePct:0,distinctPlayers:0,levels:[],valid:false,reasons:[]};
if(!txt.trim()) result.reasons.push('empty_file');
if(txt.trimStart().startsWith('<')) result.reasons.push('html_or_markup');
if(lines.length<2) result.reasons.push('header_only_or_no_rows');
const hdr=lines.length?split(lines[0]):[]; result.columns=hdr.length;
const idx=Object.fromEntries(hdr.map((h,i)=>[h,i]));
const required=['tourney_date','tourney_level','winner_id','loser_id','winner_name','loser_name','w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced','l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced'];
const missing=required.filter(k=>idx[k]==null); if(missing.length) result.reasons.push('missing_columns:'+missing.join(','));
const players=new Set(),levels=new Set(); let usable=0,wrongYear=0;
for(const line of lines.slice(1)){if(!line.trim())continue;const r=split(line);result.rows++;const d=String(r[idx.tourney_date]||'');if(d && !d.startsWith(String(year)))wrongYear++;
 levels.add(String(r[idx.tourney_level]||'')); players.add(r[idx.winner_id]||r[idx.winner_name]);players.add(r[idx.loser_id]||r[idx.loser_name]);
 const ok=['w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms'].every(k=>idx[k]!=null&&String(r[idx[k]]??'').trim()!=='');
 if(ok)usable++;
}
result.usableServeRows=usable; result.usableServePct=result.rows?usable/result.rows:0;result.distinctPlayers=[...players].filter(Boolean).length;result.levels=[...levels].sort();
if(!result.rows)result.reasons.push('zero_rows');
if(wrongYear)result.reasons.push('wrong_year_rows:'+wrongYear);
if(result.distinctPlayers<2)result.reasons.push('insufficient_players');
if(result.rows && result.usableServePct<minServe)result.reasons.push('serve_stat_coverage_below_'+minServe);
if(dataClass==='challenger' && result.levels.length && !result.levels.includes('C')) result.reasons.push('missing_challenger_level_C');
if(dataClass==='tour' && result.levels.length && result.levels.every(x=>x==='C')) result.reasons.push('challenger_only_in_tour_file');
result.valid=result.reasons.length===0;
console.log(JSON.stringify(result));
process.exit(result.valid?0:2);
