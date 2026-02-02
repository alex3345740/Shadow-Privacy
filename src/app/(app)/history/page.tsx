"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearHistory,
  notifyHistorySubscribers,
  readHistory,
  subscribeHistory,
  type HistoryItem,
} from "@/lib/history";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Input } from "@/components/ui/input";
import { PendingActionsPanel } from "@/components/pending-actions-panel";

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(items: HistoryItem[]) {
  const header = ["id", "timestamp", "kind", "status", "summary", "data"].join(",");
  const rows = items.map((it) => {
    const data = it.data ? JSON.stringify(it.data) : "";
    return [
      it.id,
      it.at,
      it.kind,
      it.status ?? "",
      `"${(it.summary ?? "").replace(/"/g, '""')}"`,
      `"${data.replace(/"/g, '""')}"`,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

export default function HistoryPage() {
  const items = useSyncExternalStore(subscribeHistory, readHistory, () => []);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (kindFilter !== "all" && it.kind !== kindFilter) return false;
      if (statusFilter !== "all" && (it.status ?? "success") !== statusFilter) return false;
      if (!query.trim()) return true;
      const hay = `${it.summary} ${it.kind} ${JSON.stringify(it.data ?? {})}`.toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    });
  }, [items, kindFilter, query, statusFilter]);

  const empty = filtered.length === 0;

  return (
    <Panel
      title="History"
      subtitle="Local-only activity history (stored in your browser)."
      right={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => downloadText("shadowprivacy-history.csv", toCsv(items))}
            disabled={items.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              clearHistory();
            }}
            disabled={items.length === 0}
          >
            Clear
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Input
          className="flex-1 min-w-[180px]"
          placeholder="Search history…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/80"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="transfer">Transfer</option>
          <option value="swap">Swap</option>
          <option value="deposit">Deposit</option>
          <option value="withdraw">Withdraw</option>
          <option value="payment">Payment</option>
          <option value="link">Link</option>
        </select>
        <select
          className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/80"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
        </select>
        <Button variant="secondary" onClick={() => notifyHistorySubscribers()}>
          Refresh
        </Button>
      </div>

      {empty ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
          No matching history entries.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((it) => {
            const prefill = typeof it.data?.prefill === "string" ? it.data.prefill : null;
            const link = typeof it.data?.link === "string" ? it.data.link : null;
            const paymentId = typeof it.data?.paymentId === "string" ? it.data.paymentId : null;
            const txSig = typeof it.data?.sig === "string" ? it.data.sig : null;
            const status = it.status ?? "success";
            return (
              <div key={it.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white/85">{it.summary}</div>
                    <div className="mt-1 text-xs text-white/40">{formatTime(it.at)}</div>
                  </div>
                  <div className="text-xs text-white/60">{it.kind.toUpperCase()}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      status === "success"
                        ? "bg-emerald-400/20 text-emerald-200"
                        : status === "failed"
                          ? "bg-red-500/20 text-red-200"
                          : "bg-amber-400/20 text-amber-200"
                    }`}
                  >
                    {status}
                  </div>
                  <div className="flex gap-2">
                    {prefill ? (
                      <a
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                        href={`/transfer?prefill=${encodeURIComponent(prefill)}`}
                      >
                        Open transfer
                      </a>
                    ) : null}
                    {paymentId ? (
                      <a
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                        href={`/pay/${paymentId}`}
                      >
                        Open payment
                      </a>
                    ) : null}
                    {link ? (
                      <a
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                        href={link}
                        target="_blank"
                      >
                        Open link
                      </a>
                    ) : null}
                    {txSig ? (
                      <a
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                        href={`https://solscan.io/tx/${txSig}`}
                        target="_blank"
                      >
                        View tx
                      </a>
                    ) : null}
                  </div>
                </div>
                {it.data ? (
                  <details className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/50">
                    <summary className="cursor-pointer">Details</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all">
                      {JSON.stringify(it.data, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <PendingActionsPanel className="mt-6" />
    </Panel>
  );
}
