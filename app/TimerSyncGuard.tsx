"use client";
import {useEffect,useLayoutEffect} from "react";

const VERSION_KEY="study-x-timer-version";
const TIMER_KEY="study-x-timer";
const CHECKPOINT_MS=1000;
const CLOUD_MS=5000;

type StoredTimer={run:boolean;mode:"Timer"|"Pomodoro"|"Stopwatch"|"Focus";total:number;startedAt:number;elapsedBefore:number;progressBaseSeconds?:number};

function readVersion(){try{const n=Number(localStorage.getItem(VERSION_KEY)||"0");return Number.isFinite(n)&&n>=0?n:0}catch{return 0}}
function writeVersion(v:number){try{localStorage.setItem(VERSION_KEY,String(v))}catch{}}
function readTimer():StoredTimer|null{try{const raw=sessionStorage.getItem(TIMER_KEY)||localStorage.getItem(TIMER_KEY);if(!raw)return null;const t=JSON.parse(raw);if(!t?.run)return null;const started=Number(t.startedAt),total=Number(t.total),elapsedBefore=Number(t.elapsedBefore)||0;if(!Number.isFinite(started)||!Number.isFinite(total)||total<0)return null;return {...t,mode:t.mode||"Timer",total,startedAt:started,elapsedBefore,progressBaseSeconds:Number.isFinite(Number(t.progressBaseSeconds))?Number(t.progressBaseSeconds):undefined}}catch{return null}}
function writeTimer(t:StoredTimer){try{const raw=JSON.stringify(t);sessionStorage.setItem(TIMER_KEY,raw);localStorage.setItem(TIMER_KEY,raw)}catch{}}
function removeTimer(){try{sessionStorage.removeItem(TIMER_KEY)}catch{};try{localStorage.removeItem(TIMER_KEY)}catch{}}
function checkpointTimer(now=Date.now()){
  const t=readTimer();if(!t)return null;
  const elapsed=Math.max(0,Math.floor((now-t.startedAt)/1000));
  const progressed=t.elapsedBefore+elapsed;
  if(t.mode!=="Stopwatch"&&progressed>=t.total){removeTimer();return null}
  const next={...t,startedAt:now,elapsedBefore:progressed};
  writeTimer(next);
  return next;
}

export default function TimerSyncGuard(){
  useLayoutEffect(()=>{
    try{
      const raw=localStorage.getItem(TIMER_KEY);
      if(raw&&!sessionStorage.getItem(TIMER_KEY))sessionStorage.setItem(TIMER_KEY,raw);
    }catch{}
  },[]);
  useEffect(()=>{
    const original=window.fetch.bind(window);
    let disposed=false;
    let lastCloudSync=0;
    const isSync=(input:RequestInfo|URL)=>{const url=typeof input==="string"?input:input instanceof Request?input.url:input.toString();return new URL(url,window.location.href).pathname==="/api/sync"};
    const syncTimer=async(forceCloud=false)=>{
      const t=checkpointTimer();if(!t)return;
      if(!forceCloud&&Date.now()-lastCloudSync<CLOUD_MS)return;
      lastCloudSync=Date.now();
      try{
        const a=await original("/api/auth",{cache:"no-store"});const auth=await a.json();if(!auth.loggedIn)return;
        const expected=readVersion();
        const r=await original("/api/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({activeTimer:t,activeTimerExpectedVersion:expected})});
        const data=await r.clone().json().catch(()=>null);
        if(Number.isFinite(Number(data?.timerVersion)))writeVersion(Number(data.timerVersion));
        if(data&&!data.accepted&&Number(data.timerVersion)>expected&&!disposed){
          if(Object.prototype.hasOwnProperty.call(data.data||{},"activeTimer")){
            try{if(data.data.activeTimer===null)removeTimer();else writeTimer(data.data.activeTimer)}catch{}
          }
        }
      }catch{}
    };
    const originalFetch=window.fetch;
    window.fetch=async(input,init)=>{
      let nextInit=init;
      let timerMutation=false;
      const requestExpected=readVersion();
      try{
        if(isSync(input)&&init?.method?.toUpperCase()==="POST"&&typeof init.body==="string"){
          const body=JSON.parse(init.body);
          if(Object.prototype.hasOwnProperty.call(body,"activeTimer")){
            timerMutation=true;
            body.activeTimerExpectedVersion=requestExpected;
            nextInit={...init,body:JSON.stringify(body)};
          }
        }
      }catch{}
      const response=await originalFetch(input,nextInit);
      if(!isSync(input))return response;
      try{
        const data=await response.clone().json();
        if(Number.isFinite(Number(data.timerVersion)))writeVersion(Number(data.timerVersion));
        if(timerMutation&&!data.accepted&&Number(data.timerVersion)>requestExpected&&!disposed){
          if(Object.prototype.hasOwnProperty.call(data.data||{},"activeTimer")){
            try{if(data.data.activeTimer===null)removeTimer();else writeTimer(data.data.activeTimer)}catch{}
          }
        }
      }catch{}
      return response;
    };
    const onStorage=(e:StorageEvent)=>{if(e.key!==VERSION_KEY)return;void originalFetch("/api/sync",{cache:"no-store"}).then(r=>r.json()).then(x=>{if(Number.isFinite(Number(x.timerVersion)))writeVersion(Number(x.timerVersion));if(x.data&&Object.prototype.hasOwnProperty.call(x.data,"activeTimer")){try{if(x.data.activeTimer===null)removeTimer();else writeTimer(x.data.activeTimer)}catch{}}}).catch(()=>{})};
    const onLogout=()=>{removeTimer();try{localStorage.removeItem(VERSION_KEY)}catch{}};
    window.addEventListener("storage",onStorage);
    window.addEventListener("studyx-logout",onLogout);
    const id=window.setInterval(()=>{void syncTimer()},CHECKPOINT_MS);
    void syncTimer(true);
    return()=>{disposed=true;window.clearInterval(id);window.fetch=original;window.removeEventListener("storage",onStorage);window.removeEventListener("studyx-logout",onLogout)};
  },[]);
  return null;
}
