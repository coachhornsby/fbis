export async function applyOAuthState(storage,r,now=Math.floor(Date.now()/1000)){
 const id=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
 if(!r||!['exchange','refresh','revoke'].includes(r.op)||!id(r.family)||typeof r.client_id!=='string'||r.client_id.length>4096)return {ok:false,error:'invalid_grant'};
 return storage.transaction(async txn=>{
  const month=new Date(now*1000).toISOString().slice(0,7);
  const s=await txn.get('oauth')||{month,count:0,codes:{},families:{}};
  if(s.month!==month){s.month=month;s.count=0;}
  // Bounded state: at most 64 codes, 16 live grants, one <=32 KiB record, no lists or alarms.
  for(const [k,exp]of Object.entries(s.codes))if(exp<=now)delete s.codes[k];
  for(const [k,v]of Object.entries(s.families))if(v.expires<=now)delete s.families[k];
  if(!Number.isSafeInteger(s.count)||s.count<0||s.count>=1000)return {ok:false,error:'temporarily_unavailable'};
  if(r.op==='exchange'){
   if(!id(r.code)||!id(r.jti)||!Number.isSafeInteger(r.codeExp)||r.codeExp<=now||r.codeExp>now+120||!Number.isSafeInteger(r.expires)||r.expires<=now||r.expires>now+30*86400||s.codes[r.code])return {ok:false,error:'invalid_grant'};
   if(Object.keys(s.codes).length>=64||Object.keys(s.families).length>=16)return {ok:false,error:'temporarily_unavailable'};
   s.codes[r.code]=r.codeExp;s.families[r.family]={client_id:r.client_id,jti:r.jti,expires:r.expires};
  }else{
   const f=s.families[r.family];if(!f||f.client_id!==r.client_id)return {ok:false,error:'invalid_grant'};
   if(r.op==='revoke')delete s.families[r.family];
   else {if(f.jti!==r.jti||!id(r.nextJti))return {ok:false,error:'invalid_grant'};f.jti=r.nextJti;}
  }
  s.count++;if(new TextEncoder().encode(JSON.stringify(s)).length>32768)return {ok:false,error:'temporarily_unavailable'};
  await txn.put('oauth',s);return {ok:true};
 });
}
