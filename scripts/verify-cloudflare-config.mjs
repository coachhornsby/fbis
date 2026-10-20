import {readFileSync,readdirSync} from 'node:fs';
export function validateCloudflareConfig(text,{pages=false}={}){
 const failures=[];
 if(!pages&&!/\[observability\.traces\]\s*\nenabled\s*=\s*true/.test(text))failures.push('traces-not-explicitly-enabled');
 let vars=false;
 for(const line of text.split('\n')){
  const section=line.match(/^\s*\[([^\]]+)\]/);if(section)vars=/(^|\.)vars$/.test(section[1]);
  if(vars&&/^\s*[A-Z0-9_]*(TOKEN|SECRET|API_KEY|PASSWORD)\s*=/.test(line))failures.push('credential-in-plain-text-vars');
 }
 const date=text.match(/compatibility_date\s*=\s*"([^"\n]+)"/)?.[1];
 if(!date||date<'2026-09-29')failures.push('compatibility-date-too-old');
 return failures;
}
if(process.argv[1]?.endsWith('verify-cloudflare-config.mjs')){
 const errors=readdirSync('.').filter(x=>/^wrangler.*\.toml$/.test(x)).flatMap(file=>validateCloudflareConfig(readFileSync(file,'utf8'),{pages:file==='wrangler.toml'}).map(error=>({file,error})));
 if(errors.length){console.error(JSON.stringify(errors));process.exitCode=1;}else console.log('Cloudflare static configuration checks passed');
}
