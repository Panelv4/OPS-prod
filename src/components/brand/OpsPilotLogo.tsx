import React from "react";

interface OpsPilotLogoProps {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  className?: string;
}

export function OpsPilotLogo({
  size = "md",
  showTagline = false,
  className = "",
}: OpsPilotLogoProps) {
  const iconDim = size === "sm" ? 28 : size === "lg" ? 38 : 32;
  const textClass =
    size === "sm"
      ? "text-base"
      : size === "lg"
      ? "text-xl"
      : "text-[17px]";

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width={iconDim}
        height={iconDim}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="36" height="36" rx="9" fill="#0F172A" className="dark:fill-indigo-600" />
        <rect
          x="0.75"
          y="0.75"
          width="34.5"
          height="34.5"
          rx="8.25"
          stroke="white"
          strokeOpacity="0.14"
          strokeWidth="1.5"
        />
        {/* Precision directional pilot wing & orbital ring */}
        <circle
          cx="18"
          cy="18"
          r="9.5"
          stroke="white"
          strokeOpacity="0.24"
          strokeWidth="1.5"
        />
        <path
          d="M24.8 11.2L14.2 15.6L11.2 24.8L20.4 21.8L24.8 11.2Z"
          fill="white"
        />
        <path
          d="M24.8 11.2L18 18L20.4 21.8L24.8 11.2Z"
          fill="#818CF8"
          className="dark:fill-slate-950/50"
        />
        <circle cx="18" cy="18" r="2" fill="#0F172A" />
      </svg>
      <div className="flex flex-col leading-none">
        <span
          className={`font-bold tracking-tight text-slate-900 dark:text-white ${textClass}`}
        >
          Ops<span className="text-indigo-600 dark:text-indigo-400">Pilot</span>
        </span>
        {showTagline && (
          <span className="mt-0.5 text-[10px] font-medium tracking-wide text-slate-500 dark:text-slate-400">
            BUSINESS OS
          </span>
        )}
      </div>
    </div>
  );
}
