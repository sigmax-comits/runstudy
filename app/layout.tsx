import "./globals.css";
import type { Metadata } from "next";
import TimerSyncGuard from "./TimerSyncGuard";
import Link from "next/link";

export const metadata: Metadata={title:"Study X — Focus with intention",description:"A calm, premium study timer and progress workspace."};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body><TimerSyncGuard/><Link href="/admin" aria-label="Open admin panel" style={{position:"fixed",top:16,right:16,zIndex:1000,width:36,height:36,display:"grid",placeItems:"center",borderRadius:999,textDecoration:"none",fontSize:24,lineHeight:1,background:"rgba(20,20,20,.72)",backdropFilter:"blur(10px)"}}>⋮</Link>{children}</body></html>
}
