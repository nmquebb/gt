import type { ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleProps {
  children: ReactNode;
  className?: string;
  title: string;
}

export function Collapsible({ children, className, title }: CollapsibleProps) {
  return (
    <details
      className={cn(
        "group rounded-lg border border-neutral-200 bg-white",
        className,
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronUp
          aria-hidden="true"
          className="size-4 text-neutral-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="max-h-[min(70vh,440px)] overflow-y-auto border-t border-neutral-200 p-3">
        {children}
      </div>
    </details>
  );
}
