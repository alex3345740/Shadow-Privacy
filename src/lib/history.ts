export type HistoryItem = {
  id: string;
  at: number;
  kind: "transfer" | "deposit" | "withdraw" | "swap" | "payment" | "link";
  summary: string;
  data?: Record<string, unknown>;
  status?: "pending" | "success" | "failed";
};

const KEY = "shadowprivacy.history.v1";
const EVENT_NAME = "shadowprivacy:history";

let cachedRaw: string | null = null;
let cachedItems: HistoryItem[] = [];

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  const normalized = raw ?? "";
  if (cachedRaw === normalized) return cachedItems;

  cachedRaw = normalized;
  if (!raw) {
    cachedItems = [];
    return cachedItems;
  }

  const parsed = safeParse(raw);
  if (!Array.isArray(parsed)) {
    cachedItems = [];
    return cachedItems;
  }

  cachedItems = parsed.filter(Boolean) as HistoryItem[];
  return cachedItems;
}

export function writeHistory(items: HistoryItem[]) {
  if (typeof window === "undefined") return;
  const next = items.slice(0, 200);
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedItems = next;
  window.localStorage.setItem(KEY, raw);
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function pushHistory(item: HistoryItem) {
  const existing = readHistory();
  writeHistory([item, ...existing]);
}

export function clearHistory() {
  if (typeof window === "undefined") return;
  cachedRaw = "";
  cachedItems = [];
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeHistory(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener("storage", handler);
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(EVENT_NAME, handler);
  };
}

export function notifyHistorySubscribers() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT_NAME));
}
