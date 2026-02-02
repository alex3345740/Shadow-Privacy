import { promises as fs, existsSync } from "fs";
import path from "path";
import os from "os";

export type PaymentStatus =
  | "created"
  | "awaiting_funds"
  | "awaiting_gas"
  | "burning"
  | "submitted"
  | "attestation_pending"
  | "attested"
  | "forwarding"
  | "depositing"
  | "completed"
  | "failed";

export type PaymentRequest = {
  id: string;
  amountUsdc: number;
  sourceDomain: number;
  sourceChain: string;
  sourceWalletAddress?: string;
  sourceWalletPrivateKeyEnc?: string;
  destinationWallet: string;
  label?: string;
  reference?: string;
  note?: string;
  autoDepositApproved?: boolean;
  createdAt: number;
  updatedAt: number;
  status: PaymentStatus;
  sourceTxHash?: string;
  attestation?: string;
  forwardTx?: string;
  depositTx?: string;
  error?: string;
};

const store = new Map<string, PaymentRequest>();
let hydrated = false;

let resolvedStorageDir: string | null = null;

function resolveStorageDir() {
  if (resolvedStorageDir) return resolvedStorageDir;
  const envDir = process.env.PAYMENT_STORE_DIR;
  const home = os.homedir();
  const candidates = [
    envDir ? path.resolve(envDir) : null,
    path.join(process.cwd(), ".data"),
    path.join(process.cwd(), "privacy-app", ".data"),
    path.join(home, "Downloads", "shadowprivacy", "privacy-app", ".data"),
    path.join(home, ".shadowprivacy", "payments"),
  ].filter(Boolean) as string[];

  const existing = candidates.find((dir) =>
    existsSync(path.join(dir, "payments.json")),
  );

  resolvedStorageDir = existing ?? candidates[candidates.length - 1];
  return resolvedStorageDir;
}

function getStorageFile() {
  const dir = resolveStorageDir();
  return path.join(dir, "payments.json");
}

async function ensureStorage() {
  const storageDir = resolveStorageDir();
  try {
    await fs.mkdir(storageDir, { recursive: true });
  } catch {
    // ignore
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await fs.readFile(getStorageFile(), "utf8");
    const parsed = JSON.parse(raw) as PaymentRequest[];
    parsed.forEach((payment) => store.set(payment.id, payment));
  } catch {
    // ignore missing file or parse errors
  }
}

async function persist() {
  await ensureStorage();
  const data = JSON.stringify(Array.from(store.values()), null, 2);
  await fs.writeFile(getStorageFile(), data, "utf8");
}

function randomId() {
  return Math.random().toString(16).slice(2);
}

export async function createPayment(
  input: Omit<PaymentRequest, "id" | "createdAt" | "updatedAt" | "status">,
) {
  await hydrate();
  const now = Date.now();
  const payment: PaymentRequest = {
    id: randomId(),
    createdAt: now,
    updatedAt: now,
    status: "created",
    ...input,
  };
  store.set(payment.id, payment);
  await persist();
  return payment;
}

export async function getPayment(id: string) {
  await hydrate();
  return store.get(id) ?? null;
}

export async function updatePayment(id: string, patch: Partial<PaymentRequest>) {
  await hydrate();
  const existing = store.get(id);
  if (!existing) return null;
  const updated: PaymentRequest = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  store.set(id, updated);
  await persist();
  return updated;
}
