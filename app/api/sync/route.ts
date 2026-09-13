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
local expected=tonumber(ARGV[2])
if expected == nil then return {0,current} end
if expected ~= current then return {0,current} end
local next=current+1
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SET',KEYS[2],tostring(next))
return {1,next}
`;

// Atomically read-merge-write the progress blob inside Redis itself.
// This closes a race condition where two near-simultaneous sync requests
// (the periodic 5s auto-sync and a manual/pause sync) could each read the
// same stale "current" progress, and whichever one's SET happened to land
// last would silently overwrite a larger, more up-to-date seconds value
// with a smaller one. Running the whole read+merge+write as one Lua script
// makes it atomic on the Redis server, so this can no longer happen.
const PROGRESS_MERGE_SCRIPT=`
local raw=redis.call('GET',KEYS[1])
local cur={}
if raw then
  local ok,decoded=pcall(cjson.decode,raw)
  if ok and type(decoded)=='table' then cur=decoded end
end
local ok2,incoming=pcall(cjson.decode,ARGV[1])
if not ok2 or type(incoming)~='table' then incoming={} end

local curSeconds=tonumber(cur.seconds) or 0
local incSeconds=tonumber(incoming.seconds) or 0
local curAt=tonumber(cur.updatedAt) or 0
local incAt=tonumber(incoming.updatedAt) or 0

local winner
if incAt>curAt or (incAt==curAt and incSeconds>=curSeconds) then winner=incoming else winner=cur end

local merged={}
for k,v in pairs(cur) do merged[k]=v end
for k,v in pairs(winner) do merged[k]=v end

merged.seconds=math.max(curSeconds,incSeconds)
merged.sessions=math.max(tonumber(cur.sessions) or 0,tonumber(incoming.sessions) or 0)
merged.updatedAt=math.max(curAt,incAt)

local daily={}
if type(cur.daily)=='table' then
  for k,v in pairs(cur.daily) do daily[k]=tonumber(v) or 0 end
end
if type(incoming.daily)=='table' then
  for k,v in pairs(incoming.daily) do
    local cv=tonumber(daily[k]) or 0
    local iv=tonumber(v) or 0
    daily[k]=math.max(cv,iv)
  end
end

merged.daily=daily

local encoded=cjson.encode(merged)
redis.call('SET',KEYS[1],encoded)
return encoded
`;

async function mergeProgressAtomic(key:string,incoming:any):Promise<any>{
  const result=await kv(["EVAL",PROGRESS_MERGE_SCRIPT,"1",key,JSON.stringify(incoming)]);
  try{return JSON.parse(String(result.result))}catch{return incoming}
}

async function writeTimer(key:string,timer:any,expectedVersion:number){
  const result=await kv(["EVAL",TIMER_VERSION_SCRIPT,"2",key,key+":version",JSON.stringify(timer),String(expectedVersion)]);
  const values=Array.isArray(result.result)?result.result.map(Number):[0,0];
  return {accepted:values[0]===1,version:Number.isFinite(values[1])?values[1]:0};
}

async function readJson(key:string,fallback:any){
  const value=await kv(["GET",key]);
  if(!value.result)return fallback;
  try{return JSON.parse(value.result)}catch{return fallback}
}

export async function GET(req:NextRequest){
  const u=current(req);if(!u)return NextResponse.json({error:"Not logged in"},{status:401});
  try{
    const key="studyx:user:"+u;
    const legacy=await readJson(key,{progress:{},tasks:[]});
    const progress=await readJson(key+":progress",legacy.progress||{});
    const tasks=await readJson(key+":tasks",Array.isArray(legacy.tasks)?legacy.tasks:[]);
    const timer=await kv(["GET",key+":timer"]);
    const versionRaw=await kv(["GET",key+":timer:version"]);
    let activeTimer:any=null;
    if(timer.result){try{activeTimer=JSON.parse(timer.result)}catch{}}
    const timerVersion=Number(versionRaw.result||0)||0;
    return NextResponse.json({username:u,data:{progress,tasks,activeTimer},timerVersion});
  }catch{return NextResponse.json({error:"Cloud storage is not configured"},{status:503})}
}

export async function POST(req:NextRequest){
  const u=current(req);if(!u)return NextResponse.json({error:"Not logged in"},{status:401});
  try{
    const body=await req.json();
    const key="studyx:user:"+u;
    const legacy=await readJson(key,{progress:{},tasks:[]});
    const currentProgress=await readJson(key+":progress",legacy.progress||{});
    const currentTasks=await readJson(key+":tasks",Array.isArray(legacy.tasks)?legacy.tasks:[]);
    const hasProgress=body.progress&&typeof body.progress==="object"&&!Array.isArray(body.progress);
    const hasTasks=Array.isArray(body.tasks);
    const hasActiveTimer=Object.prototype.hasOwnProperty.call(body,"activeTimer");
    // Progress is merged atomically on the Redis side (see PROGRESS_MERGE_SCRIPT)
    // instead of read-here-then-write-later, so overlapping requests can never
    // clobber each other and seconds can never regress.
    const progress=hasProgress?await mergeProgressAtomic(key+":progress",body.progress):currentProgress;
    const tasks=hasTasks?body.tasks:currentTasks;

    if(hasTasks)await kv(["SET",key+":tasks",JSON.stringify(tasks)]);
    if(hasProgress||hasTasks)await kv(["SET",key,JSON.stringify({progress,tasks})]);

    let timerAccepted=true;
    let activeTimer:any;
    let timerVersion=Number((await kv(["GET",key+":timer:version"])).result||0)||0;
    if(hasActiveTimer){
      const requested=Number(body.activeTimerExpectedVersion);
      const expected=Number.isFinite(requested)?requested:(timerVersion===0?0:-1);
      if(body.activeTimer?.run){
        const existingRaw=await kv(["GET",key+":timer"]);
        let existing:any=null;
        if(existingRaw.result){try{existing=JSON.parse(existingRaw.result)}catch{}}
        const nextTimer={...body.activeTimer};
        const base=Number.isFinite(Number(existing?.progressBaseSeconds))?Number(existing.progressBaseSeconds):Number(progress?.seconds||0);
        nextTimer.progressBaseSeconds=base;
        body.activeTimer=nextTimer;
      }
      const result=await writeTimer(key+":timer",body.activeTimer,expected);
      timerAccepted=result.accepted;
      timerVersion=result.version;
      const timer=await kv(["GET",key+":timer"]);
      if(timer.result){try{activeTimer=JSON.parse(timer.result)}catch{activeTimer=null}}else activeTimer=null;
    }else{
      const timer=await kv(["GET",key+":timer"]);
      if(timer.result){try{activeTimer=JSON.parse(timer.result)}catch{activeTimer=null}}else activeTimer=null;
    }

    const responseData={progress,tasks,activeTimer};
    await kv(["ZADD","studyx:leaderboard","GT",String(responseData.progress?.seconds||0),u]);
    return NextResponse.json({ok:true,accepted:timerAccepted,data:responseData,timerVersion});
  }catch{return NextResponse.json({error:"Cloud storage is not configured"},{status:503})}
}
