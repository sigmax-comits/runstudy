"use client";

/**
 * Timer persistence is owned by app/Timer.tsx.
 * This component is intentionally side-effect free so timer behavior does not
 * depend on DOM clicks, CSS class names, fetch monkey-patching, or Storage
 * prototype overrides.
 */
export default function TimerSyncGuard(){
  return null;
}
