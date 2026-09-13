"use client";
import {useCallback,useEffect,useRef,useState} from "react";

type Mode="Timer"|"Pomodoro"|"Stopwatch"|"Focus";
type Task={id:number;text:string;done:boolean};
type TimerState={mode:Mode;total:number;running:boolean;startedAt:number;elapsedBeforeStart:number};

const TIMER_KEY="study-x-timer";
const PROGRESS_KEY="study-x-progress";
const TASKS_KEY="study-x-tasks";
const modes:Mode[]=["Timer","Pomodoro","Stopwatch","Focus"];
const presets=[15,25,45,60,120];
const DEFAULT_TOTAL=1500;

function pad(n:number){return String(n).padStart(2,"0")}
function fmt(n:number){const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?pad(h)+":"+pad(m)+":"+pad(s):pad(m)+":"+pad(s)}
function defaultTimer():TimerState{return{mode:"Timer",total:DEFAULT_TOTAL,running:false,startedAt:0,elapsedBeforeStart:0}}
function readTimer():TimerState|null{try{const raw=localStorage.getItem(TIMER_KEY);if(!raw)return null;const s=JSON.parse(raw);if(!s||!modes.includes(s.mode)||!Number.isFinite(Number(s.total))||Number(s.total)<0||typeof s.running!=="boolean")return null;return{mode:s.mode,total:Number(s.total),running:s.running,startedAt:Number.isFinite(Number(s.startedAt))?Number(s.startedAt):0,elapsedBeforeStart:Math.max(0,Number(s.elapsedBeforeStart)||0)}}catch{return null}}
function writeTimer(s:TimerState){try{localStorage.setItem(TIMER_KEY,JSON.stringify(s))}catch{}}
function removeTimer(){try{localStorage.removeItem(TIMER_KEY)}catch{}}
function elapsedOf(s:TimerState,now=Date.now()){return Math.max(0,s.elapsedBeforeStart+(s.running&&s.startedAt>0?Math.floor((now-s.startedAt)/1000):0))}
function remainingOf(s:TimerState,now=Date.now()){return s.mode==="Stopwatch"?elapsedOf(s,now):Math.max(0,s.total-elapsedOf(s,now))}
type Progress={seconds:number;sessions:number;daily:Record<string,number>;pathway?:string;sequence?:number;updatedAt?:number};
function readProgress():Progress{try{return JSON.parse(localStorage.getItem(PROGRESS_KEY)||"{\"seconds\":0,\"sessions\":0,\"daily\":{}}") as Progress}catch{return{seconds:0,sessions:0,daily:{}}}}
function writeProgress(p:Progress){try{localStorage.setItem(PROGRESS_KEY,JSON.stringify(p))}catch{}}
function mergeProgress(local:Progress,cloud:any):Progress{
  const c=cloud&&typeof cloud==="object"?cloud:{};
  const lSeconds=Math.max(0,Number(local.seconds)||0),cSeconds=Math.max(0,Number(c.seconds)||0);
  const lAt=Number(local.updatedAt)||0,cAt=Number(c.updatedAt)||0;
  const cloudIsNewer=cAt>lAt||(cAt===lAt&&cSeconds>=lSeconds);
  const winner=cloudIsNewer?c:local;
  const daily:Record<string,number>={...(local.daily||{})};
  for(const [day,value] of Object.entries((c.daily||{}) as Record<string,number>))daily[day]=Math.max(Number(daily[day]||0),Number(value)||0);
  return {...local,...winner,seconds:Math.max(lSeconds,cSeconds),sessions:Math.max(Number(local.sessions)||0,Number(c.sessions)||0),daily,updatedAt:Math.max(lAt,cAt)};
}

export default function Timer(){
 const [state,setState]=useState<TimerState>(()=>readTimer()||defaultTimer());
 const [left,setLeft]=useState(()=>{const s=readTimer()||defaultTimer();return remainingOf(s)});
 const [label,setLabel]=useState("Choose subject"),[open,setOpen]=useState(false),[custom,setCustom]=useState({h:"",m:"",s:""}),[customOpen,setCustomOpen]=useState(false);
 const [tasks,setTasks]=useState<Task[]>([]),[taskText,setTaskText]=useState("");
 const [hydrated,setHydrated]=useState(false);
 const lastProgressElapsedRef=useRef(0);
 const lastCloudSyncRef=useRef(0);
 const cloudVersionRef=useRef(0);
 const stateRef=useRef(state);
 stateRef.current=state;

 const applyProgress=useCallback((fromElapsed:number,toElapsed:number,at:number)=>{
   const delta=Math.max(0,toElapsed-fromElapsed);if(!delta)return;
   const p=readProgress();p.daily=p.daily||{};const day=new Date(at).toISOString().slice(0,10);const used=p.daily[day]||0;const add=Math.min(delta,Math.max(0,20*3600-used));
   if(add<=0)return;
   p.seconds=(p.seconds||0)+add;p.daily[day]=used+add;p.updatedAt=at;writeProgress(p);
 },[]);

 const persistRunning=useCallback((current:TimerState,now=Date.now(),updateReact=true)=>{
   if(!current.running)return current;
   const elapsed=elapsedOf(current,now);const next={...current,startedAt:now,elapsedBeforeStart:elapsed};
   applyProgress(lastProgressElapsedRef.current,elapsed,now);lastProgressElapsedRef.current=elapsed;writeTimer(next);stateRef.current=next;
   if(updateReact){setState(next);setLeft(remainingOf(next,now))}
   return next;
 },[applyProgress]);

 const syncCloud=useCallback(async(timer:TimerState|null)=>{
   try{
     const auth=await fetch("/api/auth",{cache:"no-store"}).then(r=>r.json());if(!auth.loggedIn)return;
     const activeTimer=timer?{run:timer.running,mode:timer.mode,total:timer.total,startedAt:timer.startedAt||Date.now(),elapsedBefore:timer.elapsedBeforeStart}:null;
     const progress=readProgress();
     const r=await fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({activeTimer,activeTimerExpectedVersion:cloudVersionRef.current,progress})});
     const x=await r.json().catch(()=>null);if(Number.isFinite(Number(x?.timerVersion)))cloudVersionRef.current=Number(x.timerVersion);
     if(x?.data?.progress)writeProgress(mergeProgress(progress,x.data.progress));
   }catch{}
 },[]);

 useEffect(()=>{
   try{const saved=localStorage.getItem(TASKS_KEY);if(saved){const parsed=JSON.parse(saved);if(Array.isArray(parsed))setTasks(parsed)}}catch{}
   const local=readTimer();
   if(local){
     const now=Date.now();const elapsed=elapsedOf(local,now);
     if(local.running&&local.mode!=="Stopwatch"&&elapsed>=local.total){
       const p=readProgress();p.sessions=(p.sessions||0)+1;writeProgress(p);removeTimer();const reset={...local,running:false,startedAt:local.startedAt,elapsedBeforeStart:local.total};setState(reset);setLeft(0);void syncCloud(null);
     }else{setState(local);setLeft(remainingOf(local,now));lastProgressElapsedRef.current=local.elapsedBeforeStart;}
     setHydrated(true);return;
   }
   const loadCloud=async()=>{
     try{
       const auth=await fetch("/api/auth",{cache:"no-store"}).then(r=>r.json());
       if(auth.loggedIn){const r=await fetch("/api/sync",{cache:"no-store"});const x=await r.json();if(Number.isFinite(Number(x?.timerVersion)))cloudVersionRef.current=Number(x.timerVersion);const t=x?.data?.activeTimer;if(t?.run){const restored:TimerState={mode:modes.includes(t.mode)?t.mode:"Timer",total:Number(t.total)||DEFAULT_TOTAL,running:true,startedAt:Number(t.startedAt)||Date.now(),elapsedBeforeStart:Math.max(0,Number(t.elapsedBefore)||0)};writeTimer(restored);setState(restored);setLeft(remainingOf(restored));lastProgressElapsedRef.current=restored.elapsedBeforeStart;}}
     }catch{}
     setHydrated(true);
   };
   void loadCloud();
 },[syncCloud]);

 useEffect(()=>{if(!hydrated)return;try{localStorage.setItem(TASKS_KEY,JSON.stringify(tasks))}catch{}},[tasks,hydrated]);

 useEffect(()=>{
   if(!hydrated)return;
   const tick=()=>{
     const current=stateRef.current;if(!current.running)return;
     const now=Date.now();const elapsed=elapsedOf(current,now);applyProgress(lastProgressElapsedRef.current,elapsed,now);lastProgressElapsedRef.current=elapsed;setLeft(remainingOf(current,now));
     if(current.mode!=="Stopwatch"&&elapsed>=current.total){
       const p=readProgress();p.sessions=(p.sessions||0)+1;writeProgress(p);removeTimer();const finished={...current,running:false,elapsedBeforeStart:current.total};stateRef.current=finished;setState(finished);setLeft(0);void syncCloud(null);return;
     }
     if(now-lastCloudSyncRef.current>=5000){lastCloudSyncRef.current=now;persistRunning(current,now,true);void syncCloud(stateRef.current)}
   };
   tick();const id=window.setInterval(tick,250);
   const onVisibility=()=>{const current=stateRef.current;if(!current.running)return;if(document.visibilityState==="hidden"){const saved=persistRunning(current,Date.now(),true);void syncCloud(saved)}else{const now=Date.now();const elapsed=elapsedOf(stateRef.current,now);applyProgress(lastProgressElapsedRef.current,elapsed,now);lastProgressElapsedRef.current=elapsed;setLeft(remainingOf(stateRef.current,now));}};
   const onPageHide=()=>{const current=stateRef.current;if(current.running){const saved=persistRunning(current,Date.now(),false);void syncCloud(saved)}};
   document.addEventListener("visibilitychange",onVisibility);window.addEventListener("pagehide",onPageHide);
   return()=>{window.clearInterval(id);document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("pagehide",onPageHide);const current=stateRef.current;if(current.running){const saved=persistRunning(current,Date.now(),false);void syncCloud(saved)}};
 },[applyProgress,persistRunning,hydrated,syncCloud]);

 const pauseTimer=useCallback(()=>{const current=stateRef.current;if(!current.running)return;const now=Date.now();const elapsed=elapsedOf(current,now);applyProgress(lastProgressElapsedRef.current,elapsed,now);lastProgressElapsedRef.current=elapsed;const paused={...current,running:false,elapsedBeforeStart:elapsed};stateRef.current=paused;setState(paused);setLeft(remainingOf(paused));writeTimer(paused);void syncCloud(paused)},[applyProgress,syncCloud]);
 const resumeTimer=useCallback(()=>{const current=stateRef.current;if(current.running)return;const resumed={...current,running:true,startedAt:Date.now()};stateRef.current=resumed;setState(resumed);writeTimer(resumed);void syncCloud(resumed)},[syncCloud]);
 const resetTimer=useCallback(()=>{const current=stateRef.current;removeTimer();const reset={...current,running:false,startedAt:0,elapsedBeforeStart:0};stateRef.current=reset;setState(reset);setLeft(reset.mode==="Stopwatch"?0:reset.total);lastProgressElapsedRef.current=0;void syncCloud(null)},[syncCloud]);
 const selectMode=useCallback((m:Mode)=>{if(stateRef.current.running)pauseTimer();const total=m==="Pomodoro"?1500:m==="Focus"?3000:m==="Stopwatch"?0:1500;const next={mode:m,total,running:false,startedAt:0,elapsedBeforeStart:0};writeTimer(next);stateRef.current=next;setState(next);setLeft(m==="Stopwatch"?0:total);lastProgressElapsedRef.current=0},[pauseTimer]);
 const setPreset=useCallback((minutes:number)=>{if(stateRef.current.running)pauseTimer();const next={mode:"Timer" as Mode,total:minutes*60,running:false,startedAt:0,elapsedBeforeStart:0};writeTimer(next);stateRef.current=next;setState(next);setLeft(next.total);lastProgressElapsedRef.current=0},[pauseTimer]);
 const applyCustom=useCallback(()=>{const n=Math.min(20*3600,(+custom.h||0)*3600+(+custom.m||0)*60+(+custom.s||0));if(!n)return;if(stateRef.current.running)pauseTimer();const next={mode:"Timer" as Mode,total:n,running:false,startedAt:0,elapsedBeforeStart:0};writeTimer(next);stateRef.current=next;setState(next);setLeft(n);lastProgressElapsedRef.current=0},[custom,pauseTimer]);
 const addTask=()=>{const v=taskText.trim();if(!v)return;setTasks(t=>[...t,{id:Date.now(),text:v,done:false}]);setTaskText("")};
 const saveNow=()=>{const current=stateRef.current;if(current.running)persistRunning(current,Date.now(),true);const p=readProgress();void syncCloud(stateRef.current);void (async()=>{try{const auth=await fetch("/api/auth",{cache:"no-store"}).then(r=>r.json());if(!auth.loggedIn)return;await fetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({progress:p,tasks})})}catch{}})()};
 const display=remainingOf(state,Date.now());const pct=state.mode==="Stopwatch"?100:state.total?((state.total-display)/state.total)*100:0;const done=tasks.filter(t=>t.done).length;
 return <main className="timer-page">
  <div className="timer-intro"><span className="section-kicker">FOCUS / 01</span><h1>Make time for what matters.</h1><p>A quiet workspace for deliberate study.</p></div>
  <div className="mode-tabs glass-pill">{modes.map(m=><button key={m} onClick={()=>selectMode(m)} className={m===state.mode?"active-pill":""}>{m}</button>)}</div>
  <div className="timer-workspace"><aside className="session-side glass-panel"><div className="side-label">SESSION</div><div className="side-title">Choose your pace.</div><div className="preset-stack">{presets.map(n=><button key={n} onClick={()=>setPreset(n)} className={state.total===n*60&&state.mode==="Timer"?"selected-preset":""}><span>{n>=60?n/60+"h":n+"m"}</span><small>{n===25?"recommended":n===50?"deep focus":"quick session"}</small></button>)}</div><button className={"custom-trigger "+(customOpen?"open":"")} onClick={()=>setCustomOpen(v=>!v)}><span><b>Custom time</b><small>Set your own duration</small></span><i>{customOpen?"−":"+"}</i></button>{customOpen&&<div className="custom-box"><div className="custom-fields">{(["h","m","s"] as const).map(k=><label key={k}><input aria-label={k+" duration"} value={custom[k]} maxLength={2} inputMode="numeric" max={k==="h"?"20":"59"} placeholder="00" onChange={e=>setCustom({...custom,[k]:e.target.value.replace(/\D/g,"")})}/><span>{k}</span></label>)}</div><button onClick={applyCustom}>Apply duration</button></div>}<div className="side-subject"><span>SUBJECT</span><button className="label-button" onClick={()=>setOpen(v=>!v)}>{label}<span>⌄</span></button>{open&&<div className="label-menu">{["Mathematics","Physics","Chemistry","Computer Science","Biology"].map(x=><button key={x} onClick={()=>{setLabel(x);setOpen(false)}}>{x}</button>)}</div>}</div></aside><div className="timer-center"><section className="clock-card glass-panel"><div className="clock-top"><span className="timer-mode-label">{state.running?"SESSION ACTIVE":state.mode.toUpperCase()}</span><span className="clock-status">{Math.round(pct)}% complete</span></div><div className="big-clock">{fmt(display)}</div><div className="clock-bottom"><div className="time-units"><span>HOURS</span><span>MINUTES</span><span>SECONDS</span></div></div><div className="clock-progress"><div style={{width:Math.min(100,Math.max(0,pct))+"%"}}/></div></section><div className="controls"><button className="round-control" aria-label="Reset" onClick={resetTimer}>↺</button><button className="start-button" onClick={state.running?pauseTimer:resumeTimer}>{state.running?"Pause":!display&&state.total?"Restart":"Start session"}</button><button className="round-control save-control" aria-label="Save study progress" onClick={saveNow}>✓</button></div><div className="bottom-tools"><button onClick={()=>document.getElementById("task-list")?.scrollIntoView({behavior:"smooth"})}>Tasks</button><button onClick={saveNow}>Save progress</button><button>Ambient</button><button>Study room</button></div></div><section id="task-list" className="task-panel glass-panel"><div className="task-heading"><div><span className="section-kicker">WORKSPACE / 03</span><h2>Today&apos;s tasks</h2></div><span className="task-count">{done} / {tasks.length} complete</span></div><form className="task-add" onSubmit={e=>{e.preventDefault();addTask()}}><input value={taskText} onChange={e=>setTaskText(e.target.value)} placeholder="Add a study task..." aria-label="Add a study task"/><button type="submit">ADD</button></form><div className="task-items">{tasks.length===0?<div className="task-empty">No tasks yet. Add one above and keep your session focused.</div>:tasks.map(t=><div className={"task-item "+(t.done?"done":"")} key={t.id}><button type="button" className="task-check" aria-label={t.done?"Mark incomplete":"Mark complete"} onClick={()=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,done:!x.done}:x))}>{t.done?"✓":""}</button><span>{t.text}</span><button type="button" className="task-delete" aria-label="Delete task" onClick={()=>setTasks(ts=>ts.filter(x=>x.id!==t.id))}>×</button></div>)}</div></section></div><div className="timer-meta"><span>25:00 recommended</span><span>Session 01</span><span>Distraction-free</span></div>
 </main>
}
