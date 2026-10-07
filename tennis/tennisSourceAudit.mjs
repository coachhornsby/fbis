#!/usr/bin/env node
import fs from 'node:fs';

const REQUIRED=[
  'tourney_id','tourney_name','surface','tourney_level','tourney_date',
  'winner_id','winner_name','loser_id','loser_name',
  'w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced',
  'l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced'
];

function splitCsv(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true; else if(c===','){out.push(cur);cur='';} else cur+=c;
  }
  out.push(cur); return out;
}
const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]??'1']:null).filter(Boolean));
const file=args.file, kind=args.kind||'tour', expectedYear=Number(args.year);
const minServe=Number(args.minServePct ?? (kind==='challenger'?0.95:0.80));
if(!file||!Number.isInteger(expectedYear)){console.error('usage: --file PATH --kind tour|challenger --year YYYY');process.exit(2);}
let txt=''; try{txt=fs.readFileSync(file,'utf8');}catch(e){console.error(JSON.stringify({file,valid:false,errors:['read_failed']}));process.exit(1);}
const errors=[],warnings=[];
if(!txt.length) errors.push('zero_byte');
if(/^\s*</.test(txt.slice(0,200))) errors.push('html_or_xml_response');
const lines=txt.split(/\r?\n/).filter((x)=>x.length);
if(lines.length<2) errors.push('header_only_or_zero_rows');
const header=lines[0]?splitCsv(lines[0]):[], idx=Object.fromEntries(header.map((h,i)=>[h,i]));
const missing=REQUIRED.filter((h)=>idx[h]==null); if(missing.length) errors.push('missing_required_columns:'+missing.join('|'));
let usable=0,rows=0,minDate=null,maxDate=null,currentYearRows=0,prevDecRows=0,badDateRows=0;
const players=new Set(),levels={};
if(!missing.length){
  for(const line of lines.slice(1)){
    const r=splitCsv(line); if(r.length<header.length){errors.push('malformed_csv_row');break;} rows++;
    const d=String(r[idx.tourney_date]||''); if(d){minDate=minDate==null||d<minDate?d:minDate;maxDate=maxDate==null||d>maxDate?d:maxDate;
      if(d.startsWith(String(expectedYear))) currentYearRows++;
      else if(d.startsWith(String(expectedYear-1)+'12')) prevDecRows++;
      else badDateRows++;
    }
    const wid=r[idx.winner_id]||r[idx.winner_name],lid=r[idx.loser_id]||r[idx.loser_name]; if(wid)players.add(wid);if(lid)players.add(lid);
    const lv=r[idx.tourney_level]||'';levels[lv]=(levels[lv]||0)+1;
    if(r[idx.w_svpt]!==''&&r[idx.l_svpt]!==''&&r[idx.w_SvGms]!==''&&r[idx.l_SvGms]!=='') usable++;
  }
}
const servePct=rows?usable/rows:0;
if(rows===0) errors.push('zero_rows');
if(players.size===0) errors.push('zero_players');
if(rows&&servePct<minServe) errors.push('serve_stat_coverage_below_threshold');
if(rows&&badDateRows/rows>0.01) errors.push('unexpected_year_rows');
if(kind==='challenger'&&rows&&!(levels.C>0)) errors.push('challenger_class_missing_C_level');
if(kind==='tour'&&rows&&(levels.C||0)>0) errors.push('tour_file_contains_challenger_level');
const now=new Date(), currentYear=now.getUTCFullYear();
if(expectedYear===currentYear&&maxDate){
  const iso=maxDate.length===8?maxDate.slice(0,4)+'-'+maxDate.slice(4,6)+'-'+maxDate.slice(6,8):maxDate;
  const age=Math.floor((Date.now()-Date.parse(iso+'T00:00:00Z'))/864e5);
  if(Number.isFinite(age)&&age>45) warnings.push('current_year_source_stale_'+age+'_days');
}
const report={file,kind,expectedYear,bytes:Buffer.byteLength(txt),rows,requiredColumnsPresent:missing.length===0,
  usableServeRows:usable,usableServePct:+(servePct*100).toFixed(2),distinctPlayers:players.size,levels,minDate,maxDate,
  dateRows:{expectedYear:currentYearRows,previousDecember:prevDecRows,unexpected:badDateRows},minServePct:+(minServe*100).toFixed(1),
  valid:errors.length===0,errors,warnings};
console.log(JSON.stringify(report));
process.exit(report.valid?0:1);
