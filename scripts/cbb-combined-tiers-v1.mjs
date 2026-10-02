import {readFileSync,mkdirSync,writeFileSync} from "node:fs";import {createHash} from "node:crypto";
const dir=process.argv[2];if(!dir)throw new Error("frozen dataset directory required");const raw=readFileSync(dir+"/dataset.json"),m=JSON.parse(readFileSync(dir+"/manifest.json","utf8")),h=createHash("sha256").update(raw).digest("hex");if(h!==m.sha256)throw new Error("frozen dataset hash mismatch");const rows=JSON.parse(raw),num=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null},abs=Math.abs;
const profit=(win,price)=>win?(price&&price>0?price/100:price&&price<0?100/abs(price):100/110):-1;
function pick(r){const k=num(r.features?.kpSide),c=num(r.features?.cbbdSide),s=num(r.market?.spread),a=num(r.sideResidual);if(k==null||c==null||s==null||a==null||abs(k)<4||abs(s)>=20||Math.sign(k)!==Math.sign(c))return null;const home=k>0,dog=(home&&s>0)||(!home&&s<0);return{k,c,s,a,home,dog,neutral:!!r.neutral,result:a===0?0:(Math.sign(k)===Math.sign(a)?1:-1),season:+r.season,price:home?num(r.market?.homeSpreadPrice):num(r.market?.awaySpreadPrice)}}
const xs=rows.map(pick).filter(Boolean);function sum(a){let w=0,l=0,p=0,u=0;for(const x of a){if(x.result>0){w++;u+=profit(true,x.price)}else if(x.result<0){l++;u--}else p++}const d=w+l;return{n:a.length,w,l,p,winPct:d?+(100*w/d).toFixed(2):null,units:+u.toFixed(3),roi:a.length?+(100*u/a.length).toFixed(2):null}}
const defs=[
["cbbd2",x=>abs(x.c)>=2],["cbbd3",x=>abs(x.c)>=3],
["cbbd2_within2",x=>abs(x.c)>=2&&abs(x.k-x.c)<=2],["cbbd3_within2",x=>abs(x.c)>=3&&abs(x.k-x.c)<=2],
["cbbd2_neutral",x=>abs(x.c)>=2&&x.neutral],["cbbd3_neutral",x=>abs(x.c)>=3&&x.neutral],
["cbbd2_edge6",x=>abs(x.c)>=2&&abs(x.k)>=6],["cbbd3_edge6",x=>abs(x.c)>=3&&abs(x.k)>=6],
["cbbd2_dog",x=>abs(x.c)>=2&&x.dog],["cbbd3_dog",x=>abs(x.c)>=3&&x.dog],
["cbbd2_within2_neutral",x=>abs(x.c)>=2&&abs(x.k-x.c)<=2&&x.neutral],
["cbbd2_edge6_neutral",x=>abs(x.c)>=2&&abs(x.k)>=6&&x.neutral],
["cbbd2_edge6_dog",x=>abs(x.c)>=2&&abs(x.k)>=6&&x.dog]
];
const periods=[["discovery2018_22",x=>x.season<=2022],["validation2023_24",x=>x.season===2023||x.season===2024],["confirmation2025",x=>x.season===2025]];
const rules=defs.map(([name,fn])=>Object.fromEntries([["name",name],...periods.map(([pn,pf])=>[pn,sum(xs.filter(x=>pf(x)&&fn(x)))])]));
const report={ok:true,id:"CBB-COMBINED-TIERS-v1",dataset:{version:m.version,sha256:m.sha256,rowCount:m.rowCount},baseRule:"KenPom edge >=4; CBBD same side; abs spread <20",selectionPolicy:"Intersections motivated by prior >=4 test. Discovery 2018-22 and validation 2023-24 are reported before 2025 confirmation. No threshold retuning on 2025.",rules,governance:{researchOnly:true,canQualify:false,wagerAuthorization:false,frozenInputRequired:true,noRetuningOn2025:true}};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-combined-tiers-v1.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));