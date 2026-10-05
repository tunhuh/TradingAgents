"use client";

import { Tabs } from "radix-ui";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Step {
  key: string;
  title: string;
  /** Position in the agent pipeline (1–5); omitted for the full report. */
  number?: number;
  content: ReactNode;
}

/** Pipeline steps as a numbered side list (a row on narrow screens); `lead` sits above every panel. */
export function StepTabs({ steps, lead }: { steps: Step[]; lead?: ReactNode }) {
  const panelsTop = useRef<HTMLDivElement>(null);

  // The step list stays pinned while you read, so a step can be picked from deep inside a long
  // section. Bring the new section's start into view unless it's already on screen.
  function showSelectedStep() {
    requestAnimationFrame(() => {
      const anchor = panelsTop.current;
      if (!anchor) return;
      const { top } = anchor.getBoundingClientRect();
      if (top >= 0 && top < window.innerHeight) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      anchor.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
  }

  return (
    <Tabs.Root
      defaultValue={steps[0]?.key}
      onValueChange={showSelectedStep}
      orientation="vertical"
      className="grid gap-8 lg:grid-cols-[11.5rem_1fr] lg:gap-12"
    >
      <Tabs.List
        aria-label="Report sections"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0"
      >
        {steps.map((s) => (
          <Tabs.Trigger
            key={s.key}
            value={s.key}
            className={cn(
              "flex shrink-0 items-baseline gap-3 rounded-[3px] px-3 py-2 text-left text-[0.9375rem] whitespace-nowrap text-muted-foreground",
              "hover:text-foreground data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-foreground",
              s.number === undefined && "lg:mt-3 lg:border-t lg:border-border lg:pt-4",
            )}
          >
            {s.number !== undefined && <span className="w-3 text-xs">{s.number}</span>}
            {s.title}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="min-w-0">
        {lead}
        <div ref={panelsTop} aria-hidden className="scroll-mt-6" />
        {steps.map((s) => (
          <Tabs.Content key={s.key} value={s.key}>
            {s.content}
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}
