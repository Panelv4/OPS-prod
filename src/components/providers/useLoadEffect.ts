"use client";
import { useEffect } from "react";
/** Coalesce quick navigation / filter changes before starting an API read. */
export function useLoadEffect(
  load: () => Promise<void>,
  delay = 0,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      void load();
    }, delay);
    return () => clearTimeout(timer);
  }, [load, delay, enabled]);
}
