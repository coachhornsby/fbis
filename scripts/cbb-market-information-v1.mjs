import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const input=process.argv[2];
if(!input) throw new Error('dataset required');
const raw=JSON.parse(readFileSync(input,'utf8'));
const num=v=>{if(v==null||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=3)=>v==null?null:Number(v.toFixed(d));
function prep(r){
  const m=r.market||{}, open=num(m.openingOverUnder), final=num(m.overUnder), ah=num(r.actualHome), aa=num(r.actualAway);
  if(open==null||final==null||ah==null||aa==null)return null;
  const kp=num(r.kenpom?.total), cb=num(r.cbbd?.total), fs=num(r.fullStack?.total), spread=num(m.spread);
  const blend=kp!=null&&cb!=null?(kp+cb)/2:null, actual=ah+aa, move=final-open;
  return {id:r.id,season:Number(r.season),open,final,actual,move,kp,cb,fs,blend,spread,neutral:!!r.neutral,books:num(m.sourceBooks),construction:m.marketConstruction||null,
    openEdge:blend==null?null:blend-open, finalEdge:blend==null?null:blend-final,
    movedToward:blend==null?null:Math.abs(blend-final)<Math.abs(blend-open),
    movedAway:blend==null?null:Math.abs(blend-final)>Math.abs(blend-open)};
}
const D=raw.map(prep).filter(Boolean);
function bet(rows, filter, side){let w=0,l=0,p=0,u=0,n=0;for(const x of rows){if(!filter(x))continue;const s=side(x);if(s!==1&&s!==-1)continue;n++;const res=x.actual-x.final;if(res===0){p++;continue}if(Math.sign(res)===s){w++;u+=100/110}else{l++;u-=1}}const dec=w+l;return{n,w,l,p,winPct:dec?round(100*w/dec,2):null,units:round(u,3),roi:n?round(100*u/n,2):null}}
const rules=[
 ['follow_move_any',x=>x.move!==0,x=>Math.sign(x.move)],
 ['follow_move_ge1',x=>Math.abs(x.move)>=1,x=>Math.sign(x.move)],
 ['follow_move_ge2',x=>Math.abs(x.move)>=2,x=>Math.sign(x.move)],
 ['follow_move_ge3',x=>Math.abs(x.move)>=3,x=>Math.sign(x.move)],
 ['follow_up_move',x=>x.move>0,x=>1],
 ['follow_down_move',x=>x.move<0,x=>-1],
 ['move_agrees_blend',x=>x.blend!=null&&x.move!==0&&x.finalEdge!==0&&Math.sign(x.move)===Math.sign(x.finalEdge),x=>Math.sign(x.move)],
 ['move_opposes_blend_follow_model',x=>x.blend!=null&&x.move!==0&&x.finalEdge!==0&&Math.sign(x.move)!==Math.sign(x.finalEdge),x=>Math.sign(x.finalEdge)],
 ['toward_model_final_edge4',x=>x.blend!=null&&x.movedToward&&Math.abs(x.finalEdge)>=4,x=>Math.sign(x.finalEdge)],
 ['away_from_model_final_edge4',x=>x.blend!=null&&x.movedAway&&Math.abs(x.finalEdge)>=4,x=>Math.sign(x.finalEdge)],
 ['open_edge6_compressed_below4',x=>x.blend!=null&&Math.abs(x.openEdge)>=6&&Math.abs(x.finalEdge)<4,x=>Math.sign(x.openEdge)],
 ['open_below4_expanded_edge6',x=>x.blend!=null&&Math.abs(x.openEdge)<4&&Math.abs(x.finalEdge)>=6,x=>Math.sign(x.finalEdge)],
 ['home_dog_under_edge4',x=>!x.neutral&&x.spread!=null&&x.spread>0&&x.finalEdge!=null&&x.finalEdge<=-4,x=>-1],
 ['home_dog_under_edge4_line_down',x=>!x.neutral&&x.spread!=null&&x.spread>0&&x.finalEdge!=null&&x.finalEdge<=-4&&x.move<0,x=>-1],
 ['home_dog_under_edge4_line_up',x=>!x.neutral&&x.spread!=null&&x.spread>0&&x.finalEdge!=null&&x.finalEdge<=-4&&x.move>0,x=>-1],
 ['home_dog_under_edge4_no_move',x=>!x.neutral&&x.spread!=null&&x.spread>0&&x.finalEdge!=null&&x.finalEdge<=-4&&x.move===0,x=>-1],
 ['books_ge2_edge4',x=>x.books!=null&&x.books>=2&&x.finalEdge!=null&&Math.abs(x.finalEdge)>=4,x=>Math.sign(x.finalEdge)],
];
const bySeason={};
for(const s of [2024,2025])bySeason[s]=Object.fromEntries(rules.map(([name,f,side])=>[name,bet(D.filter(x=>x.season===s),f,side)]));
function mae(rows,key){const a=rows.map(x=>Math.abs(x.actual-x[key]));return a.length?round(a.reduce((s,v)=>s+v,0)/a.length,3):null}
const accuracy={};
for(const s of [2024,2025]){const rr=D.filter(x=>x.season===s);accuracy[s]={n:rr.length,openingMae:mae(rr,'open'),finalMae:mae(rr,'final'),improvement:round(mae(rr,'open')-mae(rr,'final'),3)}}
const candidate=rules.map(([name])=>name).filter(name=>{const a=bySeason[2024][name],b=bySeason[2025][name];return a.n>=25&&b.n>=50&&a.units>0&&b.units>0});
const report={id:'CBB-MARKET-INFORMATION-v1',generatedAt:new Date().toISOString(),coverage:{all:D.length,bySeason:Object.fromEntries([2024,2025].map(s=>[s,D.filter(x=>x.season===s).length]))},methodology:{discovery:2024,confirmation:2025,price:'-110 assumed',finalLine:'CBBD retained current/final historical total; not claimed timestamp-certified close',rulesFrozen:true,researchOnly:true},accuracy,bySeason,candidatesSurvivingBothYears:candidate,limitations:{openingCoverageBefore2024:false,individualBookTotalsRetained:false,ouPricesRetained:false,crossBookDispersionTestable:false,priceImbalanceTestable:false}};
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/cbb-market-information-v1.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
