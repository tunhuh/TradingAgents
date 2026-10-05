"use client";

import { useSyncExternalStore } from "react";

export interface ChartTokens {
  ink: string;
  muted: string;
  border: string;
  surface: string;
  rating: Record<string, string>;
}

const QUERY = "(prefers-color-scheme: dark)";
let cache: { dark: boolean; tokens: ChartTokens } | null = null;

function read(): ChartTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    ink: v("--foreground"),
    muted: v("--muted-foreground"),
    border: v("--border"),
    surface: v("--background"),
    rating: {
      Buy: v("--rating-buy"),
      Overweight: v("--rating-overweight"),
      Hold: v("--rating-hold"),
      Underweight: v("--rating-underweight"),
      Sell: v("--rating-sell"),
    },
  };
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): ChartTokens {
  const dark = window.matchMedia(QUERY).matches;
  if (!cache || cache.dark !== dark) cache = { dark, tokens: read() };
  return cache.tokens;
}

/** Theme colours for SVG charts, following the system light/dark setting. Null during SSR. */
export function useChartTokens(): ChartTokens | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export const axisTick = (t: ChartTokens) => ({ fill: t.muted, fontSize: 12 });
