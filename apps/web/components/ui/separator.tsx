import { cn } from "@/lib/utils";

interface SeparatorProps {
  className?: string;
}

export function Separator({ className }: SeparatorProps) {
  return (
    <div aria-hidden="true" className={cn("h-px bg-neutral-200", className)} />
  );
}
