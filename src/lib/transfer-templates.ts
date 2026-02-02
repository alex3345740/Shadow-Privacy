import type { TokenSymbol, TransferType } from "@radr/shadowwire";

export type TransferTemplate = {
  id: string;
  name: string;
  token: TokenSymbol;
  transferType: TransferType;
  recipients: Array<{ address: string; amount: string }>;
  note?: string;
  createdAt: number;
};

const KEY = "shadowprivacy.transferTemplates.v1";

function readRaw(): TransferTemplate[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TransferTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items: TransferTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)));
}

export function listTemplates() {
  return readRaw();
}

export function upsertTemplate(template: TransferTemplate) {
  const existing = readRaw();
  const next = existing.filter((item) => item.id !== template.id);
  next.unshift(template);
  writeRaw(next);
}

export function deleteTemplate(id: string) {
  writeRaw(readRaw().filter((item) => item.id !== id));
}
