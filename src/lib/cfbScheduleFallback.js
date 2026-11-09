// Retained official schedule only. Existing board rows always win; no new clock.
export function mergeCfbScheduleFallback(board,fallback,{now=Date.now()}={}){
 if(!Number.isFinite(now)||!fallback||!/^2026-11-(10|11|12|13|14)$/.test(fallback.date)||!Array.isArray(fallback.games)||fallback.games.length>100||fallback.canAuthorizeWager!==false)throw Error('CFB_SCHEDULE_FALLBACK_INVALID');
 if(board&&board.date!==fallback.date)throw Error('CFB_SCHEDULE_DATE_MISMATCH');
 const base=board||{...fallback,games:[],groups:[]},games=[...(base.games||[])],seen=new Set(games.map(g=>g.sport+'|'+g.id));
 for(const g of fallback.games){if(g.sport!=='cfb'||g.source!=='ESPN_SCOREBOARD'||g.status!=='scheduled'||g.canAuthorizeWager!==false||!Number.isFinite(Date.parse(g.start))||!Number.isFinite(Date.parse(g.capturedAt))||Date.parse(g.capturedAt)>now)throw Error('CFB_SCHEDULE_ROW_INVALID');if(Date.parse(g.start)<=now||seen.has(g.sport+'|'+g.id))continue;games.push(g);seen.add(g.sport+'|'+g.id);}
 const bySport={};for(const g of games)bySport[g.sport]=(bySport[g.sport]||0)+1;
 const groups=(base.groups||[]).filter(g=>g.sport!=='cfb');groups.push({sport:'cfb',label:'CFB',games:games.filter(g=>g.sport==='cfb'),error:null});
 return {...base,games,groups,counts:{...base.counts,games:games.length,bySport},retainedCfbSchedule:true};
}
