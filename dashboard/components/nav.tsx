"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Verdicts" },
  { href: "/batches", label: "Batches" },
  { href: "/batches/new", label: "New batch" },
];

export function Nav() {
  const pathname = usePathname();
  const current = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/reports") : pathname === href || (href === "/batches" && /^\/batches\/(?!new)/.test(pathname));

  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-7 gap-y-2 px-4 py-4 sm:px-6">
        <Link href="/" className="w-full text-lg font-extrabold tracking-[-0.03em] sm:mr-auto sm:w-auto">
          TradingAgents
        </Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current(l.href) ? "page" : undefined}
            className="text-sm text-muted-foreground underline-offset-[6px] hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-2"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
