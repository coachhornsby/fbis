import {readFileSync,mkdirSync,writeFileSync} from "node:fs";import {createHash} from "node:crypto";
const input=process.argv[2];if(!input)throw new Error("dataset input required");const direct=input.endsWith(".json");const raw=readFileSync(direct?input:input+"/dataset.json");const actualSha=createHash("sha256").update(raw).digest("hex");const m=direct?{version:process.env.CBB_SNAPSHOT_VERSION||"structural-build",sha256:actualSha,rowCount:JSON.parse(raw).length}:JSON.parse(readFileSync(input+"/manifest.json","utf8"));if(actualSha!==m.sha256)throw new Error("dataset hash mismatch");
const rows=JSON.parse(raw),num=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null},abs=Math.abs,mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const profit=w=>w?100/110:-1,key=v=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
function sum(a){let w=0,l=0,p=0,u=0;for(const x of a){if(x.result>0){w++;u+=profit(true)}else if(x.result<0){l++;u--}else p++}const d=w+l;return{n:a.length,w,l,p,winPct:d?+(100*w/d).toFixed(2):null,units:+u.toFixed(3),roi:a.length?+(100*u/a.length).toFixed(2):null}}
function candidate(r){const k=num(r.features?.kpSide),c=num(r.features?.cbbdSide),s=num(r.market?.spread),a=num(r.sideResidual);if(k==null||c==null||s==null||a==null||abs(k)<4||abs(s)>=20||Math.sign(k)!==Math.sign(c))return null;return{row:r,season:+r.season,home:k>0,result:a===0?0:(Math.sign(k)===Math.sign(a)?1:-1)}}
const candidates=rows.map(candidate).filter(Boolean);
const structuralFields=["orbRate","drbRate","efgPct","efgPctD","tovRate","tovRateD","ftr","ftrD","twoPtPct","twoPtPctD","threePtPct","threePtPctD","tempo"];
function available(r){const h=r.structural?.home||{},a=r.structural?.away||{};return structuralFields.filter(f=>num(h[f])!=null&&num(a[f])!=null)}
function directionScore(c){const r=c.row,h=r.structural?.home||{},a=r.structural?.away||{},sel=c.home?h:a,opp=c.home?a:h;let score=0,n=0,detail={};
 const add=(name,v)=>{if(v==null)return;score+=Math.sign(v);n++;detail[name]=+v.toFixed(3)};
 add("oreb",num(sel.orbRate)!=null&&num(opp.drbRate)!=null?num(sel.orbRate)-(100-num(opp.drbRate)):null);
 add("efg",num(sel.efgPct)!=null&&num(opp.efgPctD)!=null?num(sel.efgPct)-num(opp.efgPctD):null);
 add("twoPt",num(sel.twoPtPct)!=null&&num(opp.twoPtPctD)!=null?num(sel.twoPtPct)-num(opp.twoPtPctD):null);
 add("threePt",num(sel.threePtPct)!=null&&num(opp.threePtPctD)!=null?num(sel.threePtPct)-num(opp.threePtPctD):null);
 add("turnover",num(sel.tovRate)!=null&&num(opp.tovRateD)!=null?num(opp.tovRateD)-num(sel.tovRate):null);
 add("ftr",num(sel.ftr)!=null&&num(opp.ftrD)!=null?num(sel.ftr)-num(opp.ftrD):null);
 return{score,n,detail};
}
const enriched=candidates.map(c=>({...c,struct:directionScore(c),available:available(c.row)})).filter(x=>x.struct.n>0);
const defs=[["anyStructural",x=>x.struct.n>0],["structPositive",x=>x.struct.score>0],["struct2",x=>x.struct.score>=2],["struct3",x=>x.struct.score>=3],["structNonnegative",x=>x.struct.score>=0]];
const periods=[["discovery2018_22",x=>x.season<=2022],["validation2023_24",x=>x.season===2023||x.season===2024],["confirmation2025",x=>x.season===2025]];
const rules=defs.map(([name,fn])=>Object.fromEntries([["name",name],...periods.map(([pn,pf])=>[pn,sum(enriched.filter(x=>pf(x)&&fn(x)))])]));
const coverage=Object.fromEntries(periods.map(([pn,pf])=>[pn,{base:candidates.filter(pf).length,enriched:enriched.filter(pf).length,fields:Object.fromEntries(structuralFields.map(f=>[f,enriched.filter(x=>pf(x)&&x.available.includes(f)).length]))}]));
const report={ok:true,id:"CBB-STRUCTURAL-CONFIRMATION-v1",dataset:{version:m.version,sha256:m.sha256,rowCount:m.rowCount},baseRule:"KenPom edge >=4; CBBD same side; abs spread <20",coverage,rules,governance:{researchOnly:true,canQualify:false,wagerAuthorization:false,failClosedOnMissingStructural:true,warning:"This test only runs if frozen rows contain point-in-time structural snapshots. Zero/low coverage is a data-gap result, not evidence against structural matchups."}};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-structural-confirmation-v1.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
