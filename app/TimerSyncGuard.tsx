"use client";
import {useLayoutEffect} from "react";
const VERSION_KEY="study-x-timer-version";
const TIMER_KEY="study-x-timer";
const PAUSED_KEY="study-x-timer-paused";
const CHECKPOINT_MS=1000;
const CLOUD_MS=5000;
type StoredTimer={run:boolean;mode:"Timer"|"Pomodoro"|"Stopwatch"|"Focus";total:number;startedAt:number;elapsedBefore:number;progressBaseSeconds?:number};
function readVersion(){try{const n=Number(localStorage.getItem(VERSION_KEY)||"0");return Number.isFinite(n)&&n>=0?n:0}catch{return 0}}
function writeVersion(v:number){try{localStorage.setItem(VERSION_KEY,String(v))}catch{}}
function readTimer():StoredTimer|null{try{const raw=sessionStorage.getItem(TIMER_KEY)||localStorage.getItem(TIMER_KEY);if(!raw)return null;const t=JSON.parse(raw);if(!t?.run)return null;const started=Number(t.startedAt),total=Number(t.total),elapsedBefore=Number(t.elapsedBefore)||0;if(!Number.isFinite(started)||!Number.isFinite(total)||total<0)return null;return {...t,mode:t.mode||"Timer",total,startedAt:started,elapsedBefore,progressBaseSeconds:Number.isFinite(Number(t.progressBaseSeconds))?Number(t.progressBaseSeconds):undefined}}catch{return null}}
function writeTimer(t:StoredTimer){try{const raw=JSON.stringify(t);sessionStorage.setItem(TIMER_KEY,raw);localStorage.setItem(TIMER_KEY,raw)}catch{}}
function removeTimer(){try{sessionStorage.removeItem(TIMER_KEY)}catch{};try{localStorage.removeItem(TIMER_KEY)}catch{}}
function checkpointTimer(now=Date.now()){const t=readTimer();if(!t)return null;const elapsed=Math.max(0,Math.floor((now-t.startedAt)/1000));const progressed=t.elapsedBefore+elapsed;if(t.mode!=="Stopwatch"&&progressed>=t.total){removeTimer();return null}const next={...t,startedAt:now,elapsedBefore:progressed};writeTimer(next);return next}
function readPaused():StoredTimer|null{try{const raw=localStorage.getItem(PAUSED_KEY);if(!raw)return null;const t=JSON.parse(raw);if(!t||t.run!==false)return null;const total=Number(t.total),elapsedBefore=Number(t.elapsedBefore)||0;if(!Number.isFinite(total)||total<0||elapsedBefore<0)return null;return {...t,run:false,mode:t.mode||"Timer",total,startedAt:0,elapsedBefore,progressBaseSeconds:Number.isFinite(Number(t.progressBaseSeconds))?Number(t.progressBaseSeconds):undefined}}catch{return null}}
function writePaused(t:StoredTimer){try{localStorage.setItem(PAUSED_KEY,JSON.stringify({...t,run:false,startedAt:0}))}catch{}}
function clearPaused(){try{localStorage.removeItem(PAUSED_KEY)}catch{}}
function pausedForHydration(p:StoredTimer):StoredTimer{return {...p,run:true,startedAt:Date.now()}}
function isPaused(){return !!readPaused()}
function responseWithTimer(response:Response,timer:StoredTimer|null){return response.clone().json().then(data=>new Response(JSON.stringify({...data,data:{...(data.data||{}),activeTimer:timer}}),{status:response.status,statusText:response.statusText,headers:{"Content-Type":"application/json"}})).catch(()=>response)}
export default function TimerSyncGuard(){
 useLayoutEffect(()=>{
  let disposed=false,restoring=false,pauseRequested=false,handlingRemoval=false,allowTimerRemoval=false,lastCloudSync=0;
  const originalRemoveItem=Storage.prototype.removeItem;
  const originalFetch=window.fetch.bind(window);
  const removalResetTimers:number[]=[];
  const permitTimerRemoval=()=>{allowTimerRemoval=true;removalResetTimers.push(window.setTimeout(()=>{allowTimerRemoval=false},1500))};
  const onTimerControl=(event:Event)=>{
   const button=(event.target as HTMLElement|null)?.closest("button") as HTMLButtonElement|null;if(!button)return;
   if(button.classList.contains("start-button")){
    const text=(button.textContent||"").trim().toLowerCase();
    if(text==="pause"){
     const current=readTimer();if(current){const latest=checkpointTimer();if(latest)writePaused(latest);pauseRequested=true}
    }else if(!restoring)clearPaused();
    return;
   }
   if(button.classList.contains("round-control")||button.classList.contains("save-control")||button.closest(".mode-tabs")||button.closest(".preset-stack")||button.closest(".custom-box")){clearPaused();permitTimerRemoval()}
  };
  Storage.prototype.removeItem=function(key:string){
   if(this===sessionStorage&&key===TIMER_KEY&&!handlingRemoval){
    if(pauseRequested){handlingRemoval=true;try{const current=readTimer();if(current)writePaused(current)}catch{}pauseRequested=false;try{originalRemoveItem.call(this,key)}catch{}try{localStorage.removeItem(TIMER_KEY)}catch{}handlingRemoval=false;return}
    if(!allowTimerRemoval)return;
   }
   return originalRemoveItem.call(this,key);
  };
  document.addEventListener("click",onTimerControl,true);
  if(!sessionStorage.getItem(TIMER_KEY)){const p=readPaused();if(p){restoring=true;writeTimer(pausedForHydration(p))}}
  window.fetch=async(input,init)=>{
   const url=typeof input==="string"?input:input instanceof Request?input.url:input.toString();const isSync=new URL(url,window.location.href).pathname==="/api/sync";
   let nextInit=init,timerMutation=false;const requestExpected=readVersion();const localTimer=readTimer();
   try{if(isSync&&init?.method?.toUpperCase()==="POST"&&typeof init.body==="string"){
    const body=JSON.parse(init.body);if(Object.prototype.hasOwnProperty.call(body,"activeTimer")){timerMutation=true;if(isPaused()){body.activeTimer=null;body.activeTimerExpectedVersion=requestExpected}else if(localTimer){body.activeTimer=checkpointTimer()||localTimer;body.activeTimerExpectedVersion=requestExpected}else body.activeTimerExpectedVersion=requestExpected;nextInit={...init,body:JSON.stringify(body)}}
   }}catch{}
   const response=await originalFetch(input,nextInit);if(!isSync)return response;
   try{const data=await response.clone().json();const cloudVersion=Number(data.timerVersion),localVersion=requestExpected;if(Number.isFinite(cloudVersion)&&cloudVersion>localVersion)writeVersion(cloudVersion);
    const get=!init?.method||init.method.toUpperCase()==="GET";
    if(get){
     const p=readPaused();
     if(p)return responseWithTimer(response,pausedForHydration(p));
     const current=checkpointTimer();
     if(current&&(!Number.isFinite(cloudVersion)||localVersion>=cloudVersion))return responseWithTimer(response,current);
     if(!current&&Number.isFinite(cloudVersion)&&cloudVersion>localVersion&&data.data?.activeTimer){writeTimer(data.data.activeTimer);clearPaused()}
    }
    if(timerMutation&&!data.accepted&&Number(data.timerVersion)>requestExpected&&!disposed&&Object.prototype.hasOwnProperty.call(data.data||{},"activeTimer")){try{if(data.data.activeTimer===null)removeTimer();else writeTimer(data.data.activeTimer)}catch{}}
   }catch{}
   return response;
  };
  const syncTimer=async(force=false,keepalive=false)=>{if(isPaused())return;const t=checkpointTimer();if(!t)return;if(!force&&!keepalive&&Date.now()-lastCloudSync<CLOUD_MS)return;lastCloudSync=Date.now();try{const a=await originalFetch("/api/auth",{cache:"no-store",keepalive});if(!(await a.json()).loggedIn)return;const expected=readVersion();const r=await originalFetch("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({activeTimer:t,activeTimerExpectedVersion:expected}),keepalive});const data=await r.clone().json().catch(()=>null);if(Number.isFinite(Number(data?.timerVersion)))writeVersion(Number(data.timerVersion))}catch{}};
  const onStorage=(e:StorageEvent)=>{if(e.key!==VERSION_KEY||isPaused()||readTimer())return;void originalFetch("/api/sync",{cache:"no-store"}).then(r=>r.json()).then(x=>{if(readTimer()||isPaused())return;if(Number.isFinite(Number(x.timerVersion)))writeVersion(Number(x.timerVersion));if(x.data&&Object.prototype.hasOwnProperty.call(x.data,"activeTimer")){try{if(x.data.activeTimer===null)removeTimer();else writeTimer(x.data.activeTimer)}catch{}}}).catch(()=>{})};
  const onVisibility=()=>{if(document.visibilityState==="visible")void syncTimer(true);else void syncTimer(true,true)};
  const onPageHide=()=>{void syncTimer(true,true)};
  const onLogout=()=>{removeTimer();clearPaused();try{localStorage.removeItem(VERSION_KEY)}catch{}};
  window.addEventListener("storage",onStorage);window.addEventListener("studyx-logout",onLogout);document.addEventListener("visibilitychange",onVisibility);window.addEventListener("pagehide",onPageHide);
  const restoreId=window.setTimeout(()=>{if(!restoring)return;const start=document.querySelector(".start-button") as HTMLButtonElement|null;if(start&&(start.textContent||"").trim().toLowerCase()==="pause"){restoring=false;start.click()}},100);
  const id=window.setInterval(()=>{void syncTimer()},CHECKPOINT_MS);const initial=window.setTimeout(()=>{void syncTimer(true)},150);
  return()=>{disposed=true;window.clearTimeout(restoreId);window.clearInterval(id);window.clearTimeout(initial);removalResetTimers.forEach(window.clearTimeout);window.fetch=originalFetch;Storage.prototype.removeItem=originalRemoveItem;document.removeEventListener("click",onTimerControl,true);window.removeEventListener("storage",onStorage);window.removeEventListener("studyx-logout",onLogout);document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("pagehide",onPageHide)};
 },[]);return null;
}
