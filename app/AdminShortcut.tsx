"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";

export default function AdminShortcut(){
 const router=useRouter();
 useEffect(()=>{
  const onClick=(event:MouseEvent)=>{
   let el=event.target as HTMLElement|null;
   while(el&&el!==document.body){
    const text=el.textContent?.trim()||"";
    const isDots=text==="⋮"||text==="⋯"||text==="..."||text==="•••";
    if(isDots){
     const parent=el.parentElement;
     const grandparent=parent?.parentElement;
     const hasProfile=!!(parent?.textContent?.includes("@")||grandparent?.textContent?.includes("@"));
     const rect=el.getBoundingClientRect();
     if(hasProfile&&rect.left>window.innerWidth/2){
      event.preventDefault();
      event.stopPropagation();
      router.push("/admin");
      return;
     }
    }
    el=el.parentElement;
   }
  };
  document.addEventListener("click",onClick,true);
  return()=>document.removeEventListener("click",onClick,true);
 },[router]);
 return null;
}
