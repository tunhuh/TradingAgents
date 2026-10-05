import Link from "next/link";

const LINKS = [
  { href: "/", label: "Reports" },
  { href: "/batches", label: "Batches" },
  { href: "/batches/new", label: "New batch" },
];

export function Nav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="font-semibold">TradingAgents</Link>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
