import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"article">) {
  return (
    <article
      className={cn("rounded-lg border border-neutral-200 bg-white", className)}
      {...props}
    />
  );
}
