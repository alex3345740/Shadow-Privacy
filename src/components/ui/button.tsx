"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        size === "lg" ? "h-12 px-4" : "h-10 px-3",
        variant === "primary" &&
          "bg-gradient-to-r from-sky-500/90 to-emerald-400/80 text-black shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_18px_40px_rgba(46,230,200,0.10)] hover:brightness-110",
        variant === "secondary" &&
          "bg-white/6 text-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.10)] hover:bg-white/10",
        variant === "ghost" && "bg-transparent text-white/70 hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

