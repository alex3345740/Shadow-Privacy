"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/transfer", label: "Transfer" },
  { href: "/swap", label: "Swap" },
  { href: "/collect", label: "Collect" },
  { href: "/pool", label: "Pool" },
  { href: "/history", label: "History" },
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <div className="flex w-full items-center justify-between gap-6">
      <div className="flex flex-col">
        <div className="text-sm font-medium tracking-wide text-white/80">Shadow Privacy</div>
        <div className="text-xs text-white/50">
          Private transfers + cross-chain swaps
        </div>
      </div>

      <div className="rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const active =
              pathname === t.href || (t.href !== "/transfer" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition",
                  active
                    ? "bg-gradient-to-r from-sky-500/90 to-emerald-400/80 text-black shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_30px_rgba(59,182,255,0.15)]"
                    : "text-white/60 hover:text-white",
                )}
              >
                {t.label.toUpperCase()}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
