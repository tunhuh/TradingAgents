import type { Metadata } from "next";
import { Schibsted_Grotesk, Source_Serif_4 } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const grotesk = Schibsted_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "TradingAgents",
  description: "Committee verdicts, batch runs and report summaries",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${grotesk.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 pt-8 pb-24 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
