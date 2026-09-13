import {NextRequest,NextResponse} from "next/server";
import crypto from "crypto";

function secret(){return process.env.STUDY_X_AUTH_SECRET||"dev-only-change-me"}
function sign(v:string){return crypto.createHmac("sha256",secret()).update(v).digest("hex")}
function current(req:NextRequest){const t=req.cookies.get("study_x_session")?.value;if(!t)return null;const [p,s]=t.split(".");if(!p||s!==sign(p))return null;try{const x=JSON.parse(Buffer.from(p,"base64url").toString());return x.exp>Date.now()?x.u:null}catch{return null}}

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

const TIMER_VERSION_SCRIPT=`
local current=tonumber(redis.call('GET',KEYS[2]) or '0')
local incoming=tonumber(ARGV[2]) or 0
if incoming < current then return 0 end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SET',KEYS[2],ARGV[2])
return 1
`;

async function writeTimer(key:string,timer:any,version:number){
  const result=await kv(["EVAL",TIMER_VERSION_SCRIPT,"2",key,key+":version",JSON.stringify(timer),String(version)]);
  return Number(result.result||0)===1;
}

function timerVersion(timer:any,requested:number|undefined){
  if(Number.isFinite(requested))return Number(requested);
  if(timer&&typeof timer==="object"){
    const started=Number(timer.startedAt)||0;
    const elapsed=Number(timer.elapsedBefore)||0;
    return started*1000+elapsed*1000;
  }
  return Date.now();
}

export async function GET(req:NextRequest){
  const u=current(req);if(!u)return NextResponse.json({error:"Not logged in"},{status:401});
  try{
    const key="studyx:user:"+u;
    const x=await kv(["GET",key]);
    let data:any={progress:{},tasks:[],activeTimer:null};
    try{if(x.result)data={...data,...JSON.parse(x.result)}}catch{}
    const timer=await kv(["GET",key+":timer"]);
    if(timer.result){try{data.activeTimer=JSON.parse(timer.result)}catch{}}
    return NextResponse.json({username:u,data});
  }catch{return NextResponse.json({error:"Cloud storage is not configured"},{status:503})}
}

export async function POST(req:NextRequest){
  const u=current(req);if(!u)return NextResponse.json({error:"Not logged in"},{status:401});
  try{
    const body=await req.json();
    const key="studyx:user:"+u;
    const existingRaw=await kv(["GET",key]);
    let existing:any={progress:{},tasks:[]};
    try{if(existingRaw.result)existing=JSON.parse(existingRaw.result)}catch{}

    const hasProgress=body.progress&&typeof body.progress==="object"&&!Array.isArray(body.progress);
    const hasTasks=Array.isArray(body.tasks);
    const hasActiveTimer=Object.prototype.hasOwnProperty.call(body,"activeTimer");
    const data={
      progress:hasProgress?{...(existing.progress||{}),...body.progress}:(existing.progress||{}),
      tasks:hasTasks?body.tasks:(Array.isArray(existing.tasks)?existing.tasks:[])
    };

    await kv(["SET",key,JSON.stringify(data)]);

    let timerAccepted=true;
    let activeTimer:any=undefined;
    if(hasActiveTimer){
      const version=timerVersion(body.activeTimer,Number(body.activeTimerUpdatedAt));
      activeTimer=body.activeTimer;
      timerAccepted=await writeTimer(key+":timer",activeTimer,version);
    }else{
      const timer=await kv(["GET",key+":timer"]);
      if(timer.result){try{activeTimer=JSON.parse(timer.result)}catch{activeTimer=null}}
    }

    const responseData={...data,activeTimer:activeTimer===undefined?(existing.activeTimer??null):activeTimer};
    await kv(["ZADD","studyx:leaderboard","GT",String(responseData.progress?.seconds||0),u]);
    return NextResponse.json({ok:true,accepted:timerAccepted,data:responseData});
  }catch{return NextResponse.json({error:"Cloud storage is not configured"},{status:503})}
}
