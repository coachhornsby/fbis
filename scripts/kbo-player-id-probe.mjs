#!/usr/bin/env node
const gameId="20250920SSLG0";
async function post(url,data){
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded; charset=UTF-8","x-requested-with":"XMLHttpRequest","referer":"https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx"},body:new URLSearchParams(data)});
  if(!r.ok)throw new Error("HTTP_"+r.status);
  return r.json();
}
const j=await post("https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll",{leId:"1",srId:"0",seasonId:"2025",gameId});
function inspect(obj){
  if(!obj)return null;
  const table=JSON.parse(obj.table||obj.table1||"{}");
  const row=table?.rows?.[0]?.row||[];
  return row.map(c=>({keys:Object.keys(c),Text:c.Text??null,Link:c.Link??c.Href??c.href??c.Url??c.URL??null})).slice(0,6);
}
console.log("KBO_PLAYER_ID_PROBE="+JSON.stringify({
  pitcherAway:inspect(j.arrPitcher?.[0]),
  pitcherHome:inspect(j.arrPitcher?.[1]),
  hitterAway:inspect(j.arrHitter?.[0]),
  hitterHome:inspect(j.arrHitter?.[1])
}));
