import * as React from "react";
import { cn } from "@/lib/utils";

const baseClasses =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:pointer-events-none disabled:opacity-50";

type ButtonVariant = "default" | "outline";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-neutral-950 text-white hover:bg-neutral-800",
  outline:
    "border border-neutral-300 bg-white text-neutral-950 hover:bg-neutral-100",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  className,
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(baseClasses, variantClasses[variant], className)}
      {...props}
    />
  );
}
