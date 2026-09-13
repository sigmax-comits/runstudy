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

export async function GET(){
  try{
    const x=await kv(["ZREVRANGE","studyx:leaderboard","0","49","WITHSCORES"]);
    const a=x.result||[],rows:{username:string;seconds:number}[]=[];
    for(let i=0;i<a.length;i+=2)rows.push({username:String(a[i]),seconds:Number(a[i+1]||0)});
    if(rows.length===0){
      const accounts=JSON.parse(process.env.STUDY_X_ACCOUNTS||"[]") as {username:string}[];
      const fallback=accounts.length?accounts.map(x=>x.username):["RAJNIKANT07","GULSHAN07","AMBAR07"];
      for(const username of fallback){try{const u=await kv(["GET","studyx:user:"+username]);if(u.result){const d=JSON.parse(u.result),seconds=Number(d.progress?.seconds||0);if(seconds>0)rows.push({username,seconds})}}catch{}}
      rows.sort((a,b)=>b.seconds-a.seconds);
    }
    return NextResponse.json({rows},{headers:{"Cache-Control":"no-store, max-age=0"}});
  }catch{return NextResponse.json({rows:[],error:"Cloud storage is not configured"},{status:503})}
}
