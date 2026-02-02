import type { ReactNode } from "react";
import { TopNav } from "@/components/top-nav";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen app-bg">
      <div className="pointer-events-none absolute inset-0 dot-overlay" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 pt-10 sm:px-6">
        <TopNav />
        <div className="flex flex-1 justify-center pt-10">
          <div className="w-full max-w-[540px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

