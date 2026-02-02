"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  clearPendingActions,
  listPendingActions,
  notifyPendingActionsSubscribers,
  removePendingAction,
  subscribePendingActions,
  type PendingAction,
} from "@/lib/pending-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function buildTransferLink(action: PendingAction) {
  if (action.kind !== "transfer") return null;
  try {
    const encoded = btoa(JSON.stringify(action.payload ?? {}));
    return `/transfer?prefill=${encodeURIComponent(encoded)}`;
  } catch {
    return null;
  }
}

export function PendingActionsPanel({ className }: { className?: string }) {
  const items = useSyncExternalStore(subscribePendingActions, listPendingActions, () => []);

  const sorted = useMemo(
    () => items.slice().sort((a, b) => b.createdAt - a.createdAt),
    [items],
  );

  function remove(id: string) {
    removePendingAction(id);
  }

  function clearAll() {
    clearPendingActions();
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/80",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white/85">Pending actions</div>
          <div className="text-xs text-white/40">
            Stored locally if a flow fails or is interrupted.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => notifyPendingActionsSubscribers()}>
            Refresh
          </Button>
          <Button variant="secondary" onClick={clearAll} disabled={sorted.length === 0}>
            Clear
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
          No pending actions right now.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {sorted.map((item) => {
            const transferLink = buildTransferLink(item);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-white/10 bg-black/30 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-white/50">{formatTime(item.createdAt)}</div>
                    <div className="text-sm font-semibold text-white/85">
                      {item.kind.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {transferLink ? (
                      <a
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                        href={transferLink}
                      >
                        Open transfer
                      </a>
                    ) : null}
                    <Button variant="ghost" onClick={() => remove(item.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
                {item.lastError ? (
                  <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {item.lastError}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
