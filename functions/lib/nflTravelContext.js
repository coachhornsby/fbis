export const NFL_TEAM_GEO=Object.freeze({
 ARI:{lat:33.5276,lon:-112.2626,tz:"America/Phoenix",altitudeFt:1100},
 ATL:{lat:33.7554,lon:-84.4008,tz:"America/New_York",altitudeFt:1050},
 BAL:{lat:39.2780,lon:-76.6227,tz:"America/New_York",altitudeFt:20},
 BUF:{lat:42.7738,lon:-78.7870,tz:"America/New_York",altitudeFt:600},
 CAR:{lat:35.2258,lon:-80.8528,tz:"America/New_York",altitudeFt:750},
 CHI:{lat:41.8623,lon:-87.6167,tz:"America/Chicago",altitudeFt:595},
 CIN:{lat:39.0954,lon:-84.5160,tz:"America/New_York",altitudeFt:490},
 CLE:{lat:41.5061,lon:-81.6995,tz:"America/New_York",altitudeFt:575},
 DAL:{lat:32.7473,lon:-97.0945,tz:"America/Chicago",altitudeFt:615},
 DEN:{lat:39.7439,lon:-105.0201,tz:"America/Denver",altitudeFt:5280},
 DET:{lat:42.3400,lon:-83.0456,tz:"America/New_York",altitudeFt:600},
 GB:{lat:44.5013,lon:-88.0622,tz:"America/Chicago",altitudeFt:640},
 HOU:{lat:29.6847,lon:-95.4107,tz:"America/Chicago",altitudeFt:50},
 IND:{lat:39.7601,lon:-86.1639,tz:"America/Indiana/Indianapolis",altitudeFt:715},
 JAX:{lat:30.3239,lon:-81.6373,tz:"America/New_York",altitudeFt:20},
 KC:{lat:39.0489,lon:-94.4839,tz:"America/Chicago",altitudeFt:900},
 LV:{lat:36.0909,lon:-115.1833,tz:"America/Los_Angeles",altitudeFt:2000},
 LAC:{lat:33.9535,lon:-118.3392,tz:"America/Los_Angeles",altitudeFt:100},
 LAR:{lat:33.9535,lon:-118.3392,tz:"America/Los_Angeles",altitudeFt:100},
 MIA:{lat:25.9580,lon:-80.2389,tz:"America/New_York",altitudeFt:10},
 MIN:{lat:44.9738,lon:-93.2577,tz:"America/Chicago",altitudeFt:830},
 NE:{lat:42.0909,lon:-71.2643,tz:"America/New_York",altitudeFt:290},
 NO:{lat:29.9511,lon:-90.0812,tz:"America/Chicago",altitudeFt:0},
 NYG:{lat:40.8135,lon:-74.0745,tz:"America/New_York",altitudeFt:10},
 NYJ:{lat:40.8135,lon:-74.0745,tz:"America/New_York",altitudeFt:10},
 PHI:{lat:39.9008,lon:-75.1675,tz:"America/New_York",altitudeFt:40},
 PIT:{lat:40.4468,lon:-80.0158,tz:"America/New_York",altitudeFt:730},
 SEA:{lat:47.5952,lon:-122.3316,tz:"America/Los_Angeles",altitudeFt:20},
 SF:{lat:37.4030,lon:-121.9700,tz:"America/Los_Angeles",altitudeFt:40},
 TB:{lat:27.9759,lon:-82.5033,tz:"America/New_York",altitudeFt:50},
 TEN:{lat:36.1665,lon:-86.7713,tz:"America/Chicago",altitudeFt:430},
 WAS:{lat:38.9078,lon:-76.8645,tz:"America/New_York",altitudeFt:130},
});

const rad=x=>x*Math.PI/180;
export function haversineMiles(a,b){
  if(!a||!b)return null;
  const R=3958.7613,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function tzOffsetMinutes(timeZone,iso){
  try{
    const d=new Date(iso),parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
    const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    const asUtc=Date.UTC(Number(m.year),Number(m.month)-1,Number(m.day),Number(m.hour),Number(m.minute));
    return (asUtc-d.getTime())/60000;
  }catch{return null}
}
export function timeZonesCrossed(fromAbbr,toAbbr,iso){
  const a=NFL_TEAM_GEO[String(fromAbbr||"").toUpperCase()],b=NFL_TEAM_GEO[String(toAbbr||"").toUpperCase()];
  if(!a||!b)return 0;
  const oa=tzOffsetMinutes(a.tz,iso),ob=tzOffsetMinutes(b.tz,iso);
  if(oa==null||ob==null)return 0;
  return Math.round(Math.abs(ob-oa)/60);
}
