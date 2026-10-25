for(let n=0;n<40;n++){
 try{const r=await fetch('https://fbis-myz.pages.dev/api/mlb-completion',{signal:AbortSignal.timeout(45000)}),b=await r.json();if(r.ok&&b.ok&&b.fittedModels){console.log(JSON.stringify({ok:true,contract:'mlb-fitted-shadow-v1'}));process.exit(0);}}catch{}
 await new Promise(r=>setTimeout(r,15000));
}
throw Error('FITTED_API_NOT_DEPLOYED');
