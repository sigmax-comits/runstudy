"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";

export default function AdminShortcut(){
 const router=useRouter();
 useEffect(()=>{
  const bind=()=>{
   const buttons=Array.from(document.querySelectorAll("button"));
   for(const button of buttons){
    if(button.dataset.adminShortcutBound==="1")continue;
    if(button.textContent?.trim()!=="⋮")continue;
    const parent=button.parentElement;
    if(!parent?.textContent?.includes("@"))continue;
    button.dataset.adminShortcutBound="1";
    button.addEventListener("click",()=>router.push("/admin"));
   }
  };
  bind();
  const observer=new MutationObserver(bind);
  observer.observe(document.body,{childList:true,subtree:true});
  return()=>observer.disconnect();
 },[router]);
 return null;
}
