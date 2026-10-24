/** One environmental adjustment per projection. Pal daily factors include weather. */
const finite=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function mlbEnvironment(ctx={}){
 const pal=finite(ctx.palParkRunFactor),park=pal??finite(ctx.parkFactor)??1;
 const palDaily=pal!=null&&ctx.palParkIncludesWeather!==false;
 const weather=palDaily?1:finite(ctx.weatherRunFactor)??1;
 const hr=finite(ctx.palParkHrFactor);
 const residual=hr==null?0:clamp(hr-park,-.25,.25);
 return {version:'mlb-environment-v2-once',runFactor:clamp(park*(1+residual*.12)*weather*(finite(ctx.umpireRunFactor)??1),.78,1.28),parkFactor:park,weatherFactor:weather,weatherIncludedInPal:palDaily,source:palDaily?'BALLPARK_PAL_DAILY_PARK_WEATHER':'PARK_X_SEPARATE_WEATHER'};
}
