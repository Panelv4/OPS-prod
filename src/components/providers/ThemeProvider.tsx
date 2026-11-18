"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => undefined,
  setTheme: () => undefined,
});

function subscribe(change: () => void) {
  window.addEventListener("storage", change);
  window.addEventListener("opspilot-theme", change);
  return () => {
    window.removeEventListener("storage", change);
    window.removeEventListener("opspilot-theme", change);
  };
}
function readTheme(): Theme {
  try {
    return localStorage.getItem("opspilot-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribe,
    readTheme,
    () => "light" as Theme,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const setTheme = (next: Theme) => {
    try {
      window.localStorage.setItem("opspilot-theme", next);
    } catch {
      /* restricted browser storage */
    }
    window.dispatchEvent(new Event("opspilot-theme"));
  };
  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggleButton({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        theme === "light" ? "Switch to dark theme" : "Switch to light theme"
      }
      title={
        theme === "light" ? "Switch to dark theme" : "Switch to light theme"
      }
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${className}`}
    >
      {theme === "light" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
    </button>
  );
}
