import {NextResponse} from "next/server";

function redisConfig(){
  const url=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
  if(!url||!token)throw new Error("Cloud storage is not configured");
  return {url,token};
}

async function kv(command:string[]){
  const {url,token}=redisConfig();
  const r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(command),cache:"no-store"});
  if(!r.ok)throw new Error("Storage request failed");
  const json=await r.json();
  if(json.error)throw new Error(String(json.error));
  return json;
}

function liveSeconds(timer:any){
  if(!timer?.run)return 0;
  const elapsedBefore=Math.max(0,Number(timer.elapsedBefore)||0);
  const startedAt=Number(timer.startedAt)||0;
  const live=startedAt>0?Math.max(0,Math.floor((Date.now()-startedAt)/1000)):0;
  const elapsed=elapsedBefore+live;
  if(timer.mode!=="Stopwatch")return Math.min(elapsed,Math.max(0,Number(timer.total)||0));
  return elapsed;
}

export async function GET(){
  try{
    const x=await kv(["ZREVRANGE","studyx:leaderboard","0","49","WITHSCORES"]);
    const a=x.result||[];
    const names:string[]=[];
    for(let i=0;i<a.length;i+=2)names.push(String(a[i]));
    const timerValues=names.length?await kv(["MGET",...names.map(username=>"studyx:user:"+username+":timer")]):null;
    const rows:{username:string;seconds:number}[]=[];
    for(let i=0;i<a.length;i+=2){
      const username=String(a[i]);
      const stored=Number(a[i+1]||0);
      let seconds=stored;
      const raw=timerValues?.result?.[i/2];
      if(raw){try{
        const timer=JSON.parse(raw);
        const base=Math.max(0,Number(timer.progressBaseSeconds)||0);
        if(timer.run)seconds=Math.max(seconds,base+liveSeconds(timer));
      }catch{}}
      rows.push({username,seconds});
    }
    rows.sort((aa,bb)=>bb.seconds-aa.seconds||aa.username.localeCompare(bb.username));
    if(rows.length===0){
      const accounts=JSON.parse(process.env.STUDY_X_ACCOUNTS||"[]") as {username:string}[];
      const fallback=accounts.length?accounts.map(x=>x.username):["RAJNIKANT07","GULSHAN07","AMBAR07"];
      const fallbackTimers=fallback.length?await kv(["MGET",...fallback.map(username=>"studyx:user:"+username+":timer")]):null;
      for(let i=0;i<fallback.length;i++){
        const username=fallback[i];
        try{
          const u=await kv(["GET","studyx:user:"+username]);
          if(u.result){
            const d=JSON.parse(u.result),stored=Number(d.progress?.seconds||0),raw=fallbackTimers?.result?.[i];
            let seconds=stored;
            if(raw){try{const timer=JSON.parse(raw);const base=Math.max(0,Number(timer.progressBaseSeconds)||0);if(timer.run)seconds=Math.max(seconds,base+liveSeconds(timer))}catch{}}
            if(seconds>0)rows.push({username,seconds});
          }
        }catch{}
      }
      rows.sort((aa,bb)=>bb.seconds-aa.seconds||aa.username.localeCompare(bb.username));
    }
    return NextResponse.json({rows},{headers:{"Cache-Control":"no-store, max-age=0"}});
  }catch{return NextResponse.json({rows:[],error:"Cloud storage is not configured"},{status:503})}
}
