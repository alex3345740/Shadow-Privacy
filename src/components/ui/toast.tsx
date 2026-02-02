import { useEffect } from "react";
import { cn } from "@/lib/utils";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  kind?: "success" | "error" | "info";
  durationMs?: number;
};

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    if (!toast.durationMs) return;
    const timeout = setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timeout);
  }, [toast, onDismiss]);

  return (
    <div
      className={cn(
        "flex w-80 flex-col gap-1 rounded-2xl border border-white/10 bg-black/70 p-4 text-sm text-white/90 shadow-[0_30px_70px_rgba(0,0,0,0.45)] backdrop-blur",
        toast.kind === "success" && "border-emerald-400/40",
        toast.kind === "error" && "border-red-400/40",
      )}
    >
      <div className="font-semibold">{toast.title}</div>
      {toast.description ? (
        <div className="text-xs text-white/60">{toast.description}</div>
      ) : null}
      <button
        className="mt-2 self-start text-xs text-white/60 hover:text-white"
        onClick={() => onDismiss(toast.id)}
      >
        Dismiss
      </button>
    </div>
  );
}
