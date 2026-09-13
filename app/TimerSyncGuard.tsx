"use client";
import {useEffect} from "react";

const VERSION_KEY="study-x-timer-version";
const TIMER_KEY="study-x-timer";

function readVersion(){
  try{const n=Number(localStorage.getItem(VERSION_KEY)||"0");return Number.isFinite(n)&&n>=0?n:0}catch{return 0}
}
function writeVersion(v:number){try{localStorage.setItem(VERSION_KEY,String(v))}catch{}}

export default function TimerSyncGuard(){
  useEffect(()=>{
    const original=window.fetch.bind(window);
    let disposed=false;
    const isSync=(input:RequestInfo|URL)=>{
      const url=typeof input==="string"?input:input instanceof Request?input.url:input.toString();
      return new URL(url,window.location.href).pathname==="/api/sync";
    };
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
      const response=await original(input,nextInit);
      if(!isSync(input))return response;
      try{
        const data=await response.clone().json();
        if(Number.isFinite(Number(data.timerVersion)))writeVersion(Number(data.timerVersion));
        if(timerMutation&&!data.accepted&&Number(data.timerVersion)>requestExpected&&!disposed){
          if(data.data&&Object.prototype.hasOwnProperty.call(data.data,"activeTimer")){
            try{
              if(data.data.activeTimer===null)sessionStorage.removeItem(TIMER_KEY);
              else sessionStorage.setItem(TIMER_KEY,JSON.stringify(data.data.activeTimer));
            }catch{}
          }
          setTimeout(()=>{if(!disposed)window.location.reload()},0);
        }
      }catch{}
      return response;
    };
    const onStorage=(e:StorageEvent)=>{
      if(e.key!==VERSION_KEY)return;
      void original("/api/sync",{cache:"no-store"}).then(r=>r.json()).then(x=>{
        if(Number.isFinite(Number(x.timerVersion)))writeVersion(Number(x.timerVersion));
        if(x.data&&Object.prototype.hasOwnProperty.call(x.data,"activeTimer")){
          if(x.data.activeTimer===null)sessionStorage.removeItem(TIMER_KEY);
          else sessionStorage.setItem(TIMER_KEY,JSON.stringify(x.data.activeTimer));
        }
      }).catch(()=>{});
    };
    window.addEventListener("storage",onStorage);
    return()=>{disposed=true;window.fetch=original;window.removeEventListener("storage",onStorage)};
  },[]);
  return null;
}
