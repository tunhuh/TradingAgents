import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Long-form report text: serif, ≤70ch lines, tables and headings in the grotesk. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-ledger max-w-[70ch] font-serif text-[1.0625rem] leading-[1.65]",
        "prose-headings:font-sans prose-headings:tracking-[-0.02em] prose-h2:text-2xl prose-h3:text-lg",
        "prose-table:font-sans prose-table:text-sm prose-code:font-sans prose-code:text-[0.9em]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Wide report tables scroll inside their own box instead of widening the page.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
