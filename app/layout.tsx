import "./globals.css";
import type { Metadata } from "next";
import TimerSyncGuard from "./TimerSyncGuard";

export const metadata: Metadata={title:"Study X — Focus with intention",description:"A calm, premium study timer and progress workspace."};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body><TimerSyncGuard/>{children}</body></html>
}
