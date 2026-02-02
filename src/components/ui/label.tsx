import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-xs font-semibold text-white/70", className)}>{children}</div>;
}

