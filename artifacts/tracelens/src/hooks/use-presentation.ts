import { useSyncExternalStore } from "react";

export type PresentationMode = "journey" | "developer";
const KEY = "tracelens.presentation";
const EVENT = "tracelens:presentation";
let fallback: PresentationMode = "journey";
function read(): PresentationMode {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "developer" ? "developer" : stored === "journey" ? "journey" : fallback;
  } catch { return fallback; }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
}
export function usePresentation() {
  const mode = useSyncExternalStore(subscribe, read, () => "journey" as const);
  function setMode(next: PresentationMode) {
    fallback = next;
    try { localStorage.setItem(KEY, next); } catch { /* Browsers can disable local storage. */ }
    window.dispatchEvent(new Event(EVENT));
  }
  return [mode, setMode] as const;
}
