"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export function Input({ className, mono, ...props }: Props) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/90 outline-none ring-0 placeholder:text-white/30 focus:border-sky-400/40 focus:shadow-[0_0_0_4px_rgba(59,182,255,0.12)]",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

