export type PendingAction = {
  id: string;
  createdAt: number;
  kind: "deposit" | "withdraw" | "transfer" | "swap" | "payment";
  payload: Record<string, unknown>;
  lastError?: string;
};

const KEY = "shadowprivacy.pending.v1";
const EVENT_NAME = "shadowprivacy:pending-actions";

let cachedRaw: string | null = null;
let cachedItems: PendingAction[] = [];

function readRaw(): PendingAction[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  const normalized = raw ?? "";
  if (cachedRaw === normalized) return cachedItems;

  cachedRaw = normalized;
  if (!raw) {
    cachedItems = [];
    return cachedItems;
  }
  try {
    const parsed = JSON.parse(raw) as PendingAction[];
    cachedItems = Array.isArray(parsed) ? parsed : [];
    return cachedItems;
  } catch {
    cachedItems = [];
    return cachedItems;
  }
}

function writeRaw(items: PendingAction[]) {
  if (typeof window === "undefined") return;
  const next = items.slice(0, 50);
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedItems = next;
  window.localStorage.setItem(KEY, raw);
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function listPendingActions() {
  return readRaw();
}

export function addPendingAction(action: PendingAction) {
  const existing = readRaw();
  writeRaw([action, ...existing]);
}

export function removePendingAction(id: string) {
  writeRaw(readRaw().filter((item) => item.id !== id));
}

export function clearPendingActions() {
  writeRaw([]);
}

export function subscribePendingActions(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener("storage", handler);
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(EVENT_NAME, handler);
  };
}

export function notifyPendingActionsSubscribers() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT_NAME));
}
