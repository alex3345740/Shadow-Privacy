"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  InsufficientBalanceError,
  RecipientNotFoundError,
  SUPPORTED_TOKENS,
  TokenUtils,
  initWASM,
  isWASMSupported,
  type TokenSymbol,
  type TransferType,
} from "@radr/shadowwire";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams } from "next/navigation";
import { WalletButton } from "@/components/wallet-button";
import { createShadowWireClient } from "@/lib/shadowwire";
import { pushHistory } from "@/lib/history";
import { errorMessage } from "@/lib/errors";
import { parseRecipientsCsv, exportRecipientsCsv } from "@/lib/csv";
import { addPendingAction, removePendingAction } from "@/lib/pending-actions";
import {
  deleteContact,
  listContacts,
  searchContacts,
  upsertContact,
  type AddressBookContact,
} from "@/lib/address-book";
import {
  deleteTemplate,
  listTemplates,
  upsertTemplate,
  type TransferTemplate,
} from "@/lib/transfer-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast-provider";

type RecipientRow = {
  id: string;
  address: string;
  amount: string;
  delaySeconds?: string;
  transferType?: TransferType;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId() {
  return Math.random().toString(16).slice(2);
}

function encodePrefill(payload: Record<string, unknown>) {
  return btoa(JSON.stringify(payload));
}

function shortAddr(addr: string) {
  const a = addr.trim();
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function isValidSolanaAddress(address: string) {
  try {
    const key = new PublicKey(address.trim());
    return Boolean(key);
  } catch {
    return false;
  }
}

function TransferPageInner() {
  const client = useMemo(() => createShadowWireClient(), []);
  const { publicKey, signMessage } = useWallet();
  const { pushToast } = useToast();
  const searchParams = useSearchParams();

  const walletAddress = publicKey?.toBase58() ?? null;

  const [mode, setMode] = useState<"simple" | "multi">("multi");
  const [wasmReady, setWasmReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [useLocalProofs, setUseLocalProofs] = useState(false);

  const [token, setToken] = useState<TokenSymbol>("SOL");
  const [transferType, setTransferType] = useState<TransferType>("internal");
  const [fallbackToExternal, setFallbackToExternal] = useState(true);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  const [rows, setRows] = useState<RecipientRow[]>([
    { id: randomId(), address: "", amount: "", delaySeconds: "", transferType: undefined },
  ]);
  const [delaySeconds, setDelaySeconds] = useState("3");
  const [jitterSeconds, setJitterSeconds] = useState("2");

  const [addressBookQuery, setAddressBookQuery] = useState("");
  const [contacts, setContacts] = useState<AddressBookContact[]>([]);
  const [templates, setTemplates] = useState<TransferTemplate[]>([]);
  const [newContactName, setNewContactName] = useState("");
  const [newContactTags, setNewContactTags] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [csvInput, setCsvInput] = useState("");
  const [transferLink, setTransferLink] = useState("");

  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setContacts(listContacts());
    setTemplates(listTemplates());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setError(null);

      if (!isWASMSupported()) {
        setError("WebAssembly not supported in this browser.");
        return;
      }

      try {
        await initWASM("/wasm/settler_wasm_bg.wasm");
        if (!cancelled) setWasmReady(true);
      } catch (e: unknown) {
        if (!cancelled) setError(`Failed to initialize proofs: ${errorMessage(e)}`);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const payload = searchParams?.get("prefill");
    if (!payload) return;
    try {
      const decoded = decodeURIComponent(payload);
      const parsed = JSON.parse(atob(decoded));
      if (parsed.token) setToken(parsed.token);
      if (parsed.transferType) setTransferType(parsed.transferType);
      if (parsed.mode) setMode(parsed.mode);
      if (Array.isArray(parsed.rows)) {
        setRows(
          parsed.rows.map((row: RecipientRow) => ({
            id: randomId(),
            address: row.address ?? "",
            amount: row.amount ?? "",
            delaySeconds: row.delaySeconds ?? "",
            transferType: row.transferType,
          })),
        );
      }
      if (parsed.delaySeconds) setDelaySeconds(parsed.delaySeconds);
      if (parsed.jitterSeconds) setJitterSeconds(parsed.jitterSeconds);
      pushToast({ title: "Transfer link loaded", description: "Fields prefilled from link." });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function refreshBalance() {
    if (!walletAddress) {
      setPoolAvailable(null);
      return;
    }
    try {
      const bal = await client.getBalance(walletAddress, token);
      const available = TokenUtils.fromSmallestUnit(bal.available, token);
      setPoolAvailable(available);
    } catch {
      setPoolAvailable(null);
    }
  }

  useEffect(() => {
    refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, token]);

  function refreshContacts(query = addressBookQuery) {
    setContacts(searchContacts(query));
  }

  function handleAddContact() {
    if (!recipient.trim() && mode === "simple") return;
    const address = mode === "simple" ? recipient.trim() : rows[0]?.address?.trim() ?? "";
    if (!address) return;
    if (!isValidSolanaAddress(address)) {
      pushToast({ title: "Invalid address", description: "Enter a valid Solana address.", kind: "error" });
      return;
    }
    const contact: AddressBookContact = {
      id: randomId(),
      name: newContactName.trim() || shortAddr(address),
      address,
      tags: newContactTags.split(",").map((t) => t.trim()).filter(Boolean),
      createdAt: Date.now(),
    };
    upsertContact(contact);
    setNewContactName("");
    setNewContactTags("");
    refreshContacts();
    pushToast({ title: "Contact saved", description: contact.name, kind: "success" });
  }

  function handleSaveTemplate() {
    const payload: TransferTemplate = {
      id: randomId(),
      name: templateName.trim() || `Template ${new Date().toLocaleDateString()}`,
      token,
      transferType,
      recipients:
        mode === "simple"
          ? [{ address: recipient, amount }]
          : rows.map((row) => ({ address: row.address, amount: row.amount })),
      createdAt: Date.now(),
    };
    upsertTemplate(payload);
    setTemplateName("");
    setTemplates(listTemplates());
    pushToast({ title: "Template saved", description: payload.name, kind: "success" });
  }

  function applyTemplate(template: TransferTemplate) {
    setToken(template.token);
    setTransferType(template.transferType);
    setMode(template.recipients.length > 1 ? "multi" : "simple");
    if (template.recipients.length <= 1) {
      setRecipient(template.recipients[0]?.address ?? "");
      setAmount(template.recipients[0]?.amount ?? "");
    } else {
      setRows(
        template.recipients.map((row) => ({
          id: randomId(),
          address: row.address,
          amount: row.amount,
          delaySeconds: "",
        })),
      );
    }
    pushToast({ title: "Template applied", description: template.name });
  }

  function handleCsvImport() {
    const parsed = parseRecipientsCsv(csvInput);
    if (parsed.length === 0) {
      pushToast({ title: "CSV import failed", description: "No valid rows found.", kind: "error" });
      return;
    }
    setMode("multi");
    setRows(
      parsed.map((row) => ({
        id: randomId(),
        address: row.address,
        amount: row.amount ?? "",
        delaySeconds: row.delaySeconds ?? "",
      })),
    );
    pushToast({ title: "Recipients imported", description: `${parsed.length} rows loaded` });
  }

  function handleCsvExport() {
    const payload = exportRecipientsCsv(
      mode === "simple"
        ? [{ address: recipient, amount }]
        : rows.map((row) => ({ address: row.address, amount: row.amount, delaySeconds: row.delaySeconds })),
    );
    navigator.clipboard.writeText(payload);
    pushToast({ title: "CSV copied", description: "Recipients copied to clipboard." });
  }

  function buildPrefillPayload() {
    return {
      mode,
      token,
      transferType,
      recipient,
      amount,
      rows,
      delaySeconds,
      jitterSeconds,
    };
  }

  function createTransferLink() {
    const payload = buildPrefillPayload();
    const encoded = encodePrefill(payload);
    const link = `${window.location.origin}/transfer?prefill=${encodeURIComponent(encoded)}`;
    setTransferLink(link);
    navigator.clipboard.writeText(link);
    pushToast({ title: "Transfer link copied", description: "Share this link to prefill recipients." });
    pushHistory({
      id: randomId(),
      at: Date.now(),
      kind: "link",
      summary: "Transfer link created",
      data: { link, prefill: encoded, payload },
      status: "success",
    });
  }

  function applyContact(contact: AddressBookContact) {
    if (mode === "simple") {
      setRecipient(contact.address);
      return;
    }
    setRows((prev) => {
      const existing = prev.find((row) => !row.address.trim());
      if (existing) {
        return prev.map((row) =>
          row.id === existing.id ? { ...row, address: contact.address } : row,
        );
      }
      return [
        ...prev,
        { id: randomId(), address: contact.address, amount: "", delaySeconds: "", transferType: undefined },
      ];
    });
  }

  const summary = useMemo(() => {
    if (mode === "simple") {
      const a = Number(amount || "0");
      const valid = Number.isFinite(a) && a > 0;
      const fee = valid ? client.calculateFee(a, token).fee : 0;
      return { count: valid ? 1 : 0, total: valid ? a : 0, fee, weights: [] as number[] };
    }
    let count = 0;
    let total = 0;
    const weights: number[] = [];
    for (const r of rows) {
      const a = Number(r.amount || "0");
      if (r.address.trim() && Number.isFinite(a) && a > 0) {
        total += a;
        count += 1;
        weights.push(a);
      } else {
        weights.push(0);
      }
    }
    const fee = total > 0 ? client.calculateFee(total, token).fee : 0;
    const sum = weights.reduce((acc, val) => acc + val, 0) || 1;
    return { count, total, fee, weights: weights.map((w) => w / sum) };
  }, [amount, client, mode, rows, token]);

  const minimumAmount = useMemo(() => client.getMinimumAmount(token), [client, token]);

  const privacyScore = useMemo(() => {
    let score = 40;
    if (transferType === "internal") score += 30;
    if (mode === "multi") score += 10;
    if (Number(delaySeconds) > 0 || Number(jitterSeconds) > 0) score += 10;
    if (useLocalProofs) score += 10;
    return Math.min(100, score);
  }, [delaySeconds, jitterSeconds, mode, transferType, useLocalProofs]);

  async function handleSimpleTransfer() {
    if (!walletAddress) throw new Error("Connect a Solana wallet first.");
    if (!signMessage) throw new Error("Your wallet doesn't support message signing.");
    if (!recipient.trim()) throw new Error("Recipient address is required.");
    if (!isValidSolanaAddress(recipient)) throw new Error("Recipient address is invalid.");
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Invalid amount.");
    if (amountNum < minimumAmount) {
      throw new Error(`Amount below minimum (${minimumAmount} ${token}).`);
    }

    if (useLocalProofs && transferType === "internal") {
      const proof = await client.generateProofLocally(amountNum, token);
      const result = await client.transferWithClientProofs({
        sender: walletAddress,
        recipient: recipient.trim(),
        amount: amountNum,
        token,
        type: transferType,
        customProof: proof,
        wallet: { signMessage },
      });
      return result.tx_signature;
    }

    const result = await client.transfer({
      sender: walletAddress,
      recipient: recipient.trim(),
      amount: amountNum,
      token,
      type: transferType,
      wallet: { signMessage },
    });

    return result.tx_signature;
  }

  async function handleMultiTransfer() {
    if (!walletAddress) throw new Error("Connect a Solana wallet first.");
    if (!signMessage) throw new Error("Your wallet doesn't support message signing.");

    const normalized = rows
      .map((r) => ({
        id: r.id,
        address: r.address.trim(),
        amount: r.amount.trim(),
        delaySeconds: r.delaySeconds?.trim() ?? "",
        transferType: r.transferType,
      }))
      .filter((r) => r.address.length > 0 && r.amount.length > 0);

    if (normalized.length === 0) throw new Error("Add at least one recipient and amount.");

    const baseDelayMs = Math.max(0, Math.floor(Number(delaySeconds) * 1000));
    const jitterMs = Math.max(0, Math.floor(Number(jitterSeconds) * 1000));

    const txs: string[] = [];
    for (let i = 0; i < normalized.length; i += 1) {
      const row = normalized[i]!;
      const amountNum = Number(row.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error(`Invalid amount for recipient ${i + 1}.`);
      }
      if (!isValidSolanaAddress(row.address)) {
        throw new Error(`Invalid address for recipient ${i + 1}.`);
      }
      if (amountNum < minimumAmount) {
        throw new Error(`Amount below minimum for recipient ${i + 1}.`);
      }

      const rowTransferType = row.transferType ?? transferType;

      const attempt = async (type: TransferType) => {
        if (useLocalProofs && type === "internal") {
          const proof = await client.generateProofLocally(amountNum, token);
          return client.transferWithClientProofs({
            sender: walletAddress,
            recipient: row.address,
            amount: amountNum,
            token,
            type,
            customProof: proof,
            wallet: { signMessage },
          });
        }
        return client.transfer({
          sender: walletAddress,
          recipient: row.address,
          amount: amountNum,
          token,
          type,
          wallet: { signMessage },
        });
      };

      try {
        const res = await attempt(rowTransferType);
        txs.push(res.tx_signature);
      } catch (e) {
        if (rowTransferType === "internal" && fallbackToExternal && e instanceof RecipientNotFoundError) {
          const res = await attempt("external");
          txs.push(res.tx_signature);
        } else {
          throw e;
        }
      }

      if (i < normalized.length - 1) {
        const extra = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
        const rowDelay = Math.max(0, Math.floor(Number(row.delaySeconds || 0) * 1000));
        const wait = baseDelayMs + extra + rowDelay;
        if (wait > 0) await sleep(wait);
      }
    }

    return txs;
  }

  async function onSubmit() {
    setError(null);
    setSuccess(null);

    if (!wasmReady) {
      setError("Proof system not initialized yet.");
      return;
    }

    setLoading(true);
    const actionId = randomId();
    const prefill = encodePrefill(buildPrefillPayload());
    addPendingAction({
      id: actionId,
      createdAt: Date.now(),
      kind: "transfer",
      payload: { mode, token, transferType, recipient, amount, rows, prefill },
    });
    try {
      if (mode === "simple") {
        const sig = await handleSimpleTransfer();
        setSuccess(`Transfer submitted: ${sig}`);
        pushHistory({
          id: randomId(),
          at: Date.now(),
          kind: "transfer",
          summary: `Transfer ${amount || "?"} ${token} -> ${shortAddr(recipient)}`,
          data: { token, transferType, mode, sig, prefill },
          status: "success",
        });
        removePendingAction(actionId);
        pushToast({ title: "Transfer sent", description: sig, kind: "success" });
      } else {
        const sigs = await handleMultiTransfer();
        setSuccess(`Submitted ${sigs.length} transfers.`);
        pushHistory({
          id: randomId(),
          at: Date.now(),
          kind: "transfer",
          summary: `Multi-send ${summary.total.toFixed(4)} ${token} (${summary.count} recipients)`,
          data: { token, transferType, mode, sigs, prefill },
          status: "success",
        });
        removePendingAction(actionId);
        pushToast({ title: "Transfers sent", description: `${sigs.length} transfers`, kind: "success" });
      }
      await refreshBalance();
    } catch (e: unknown) {
      const message =
        e instanceof InsufficientBalanceError
          ? "Insufficient pool balance."
          : e instanceof RecipientNotFoundError
            ? "Recipient not found (internal transfers require a ShadowWire account)."
            : errorMessage(e);
      setError(message);
      removePendingAction(actionId);
      addPendingAction({
        id: actionId,
        createdAt: Date.now(),
        kind: "transfer",
        payload: { mode, token, transferType, recipient, amount, rows, prefill },
        lastError: message,
      });
      pushToast({ title: "Transfer failed", description: message, kind: "error" });
      pushHistory({
        id: randomId(),
        at: Date.now(),
        kind: "transfer",
        summary: `Transfer failed (${token})`,
        data: { error: message },
        status: "failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Private Transfer"
      subtitle="Send tokens privately using ShadowWire pool balances."
      right={<WalletButton />}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "multi", label: "Multi-send" },
              { value: "simple", label: "Simple" },
            ]}
          />

          <div className="text-right">
            <div className="text-xs text-white/40">Pool available</div>
            <div className="text-sm font-semibold text-white/80">
              {poolAvailable === null ? "—" : `${poolAvailable.toFixed(6)} ${token}`}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-white/50">Privacy score</div>
            <div className="mt-1 text-lg font-semibold text-white/90">{privacyScore}/100</div>
            <div className="text-xs text-white/40">
              {transferType === "internal" ? "Private transfer" : "External transfer"}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-white/50">Minimum amount</div>
            <div className="mt-1 text-lg font-semibold text-white/90">
              {minimumAmount.toFixed(4)} {token}
            </div>
            <div className="text-xs text-white/40">Based on current fee table</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-white/50">Proof mode</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className={`rounded-full px-3 py-1 text-xs ${
                  useLocalProofs ? "bg-emerald-400/20 text-emerald-200" : "bg-white/5 text-white/50"
                }`}
                onClick={() => setUseLocalProofs((prev) => !prev)}
              >
                {useLocalProofs ? "Local proofs" : "Server proofs"}
              </button>
              <span className="text-xs text-white/40">
                {useLocalProofs ? "Highest privacy" : "Fastest flow"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Token</Label>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/90 outline-none focus:border-sky-400/40"
              value={token}
              onChange={(e) => setToken(e.target.value as TokenSymbol)}
            >
              {SUPPORTED_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="text-xs text-white/40">
              Minimum: {client.getMinimumAmount(token).toFixed(6)} {token}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="flex rounded-xl border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  transferType === "internal"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80"
                }`}
                onClick={() => setTransferType("internal")}
              >
                PRIVATE
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${
                  transferType === "external"
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:text-white/80"
                }`}
                onClick={() => setTransferType("external")}
              >
                PUBLIC
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-white/50">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={fallbackToExternal}
                onChange={(e) => setFallbackToExternal(e.target.checked)}
                disabled={transferType !== "internal"}
              />
              Fallback to external if recipient not found
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-white/80">Address book</div>
              <div className="text-xs text-white/40">Quickly reuse trusted recipients.</div>
            </div>
            <Button variant="secondary" onClick={() => refreshContacts()}>
              Refresh
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Input
              placeholder="Search contacts"
              value={addressBookQuery}
              onChange={(e) => {
                setAddressBookQuery(e.target.value);
                refreshContacts(e.target.value);
              }}
            />
            <Button variant="secondary" onClick={handleAddContact}>
              Save current
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Contact name"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
            />
            <Input
              placeholder="Tags (comma separated)"
              value={newContactTags}
              onChange={(e) => setNewContactTags(e.target.value)}
            />
          </div>
          {contacts.length === 0 ? (
            <div className="text-xs text-white/40">No contacts yet.</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="rounded-xl border border-white/10 bg-black/30 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white/80">{contact.name}</div>
                      <div className="text-xs text-white/40">{shortAddr(contact.address)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-emerald-200 hover:text-white"
                        onClick={() => applyContact(contact)}
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-300 hover:text-white"
                        onClick={() => {
                          deleteContact(contact.id);
                          refreshContacts();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {contact.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {contact.tags.map((tag) => (
                        <span
                          key={`${contact.id}-${tag}`}
                          className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-white/80">Templates</div>
              <div className="text-xs text-white/40">Save transfer presets.</div>
            </div>
            <Button variant="secondary" onClick={handleSaveTemplate}>
              Save template
            </Button>
          </div>
          <Input
            placeholder="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          {templates.length === 0 ? (
            <div className="text-xs text-white/40">No templates saved yet.</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-xl border border-white/10 bg-black/30 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white/80">{template.name}</div>
                      <div className="text-xs text-white/40">
                        {template.recipients.length} recipients · {template.token}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-emerald-200 hover:text-white"
                        onClick={() => applyTemplate(template)}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="text-xs text-red-300 hover:text-white"
                        onClick={() => {
                          deleteTemplate(template.id);
                          setTemplates(listTemplates());
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white/80">CSV tools</div>
              <div className="text-xs text-white/40">
                Import/export recipients (address,amount,delaySeconds).
              </div>
            </div>
            <Button variant="secondary" onClick={handleCsvExport}>
              Copy CSV
            </Button>
          </div>
          <textarea
            className="h-24 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/80 outline-none"
            placeholder="address,amount,delaySeconds"
            value={csvInput}
            onChange={(e) => setCsvInput(e.target.value)}
          />
          <Button variant="secondary" onClick={handleCsvImport}>
            Import CSV
          </Button>
        </div>

        {mode === "simple" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Recipient</Label>
              <Input mono placeholder="Solana address" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              {recipient && !isValidSolanaAddress(recipient) ? (
                <div className="text-xs text-red-200">Invalid Solana address</div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder={`0.0 ${token}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Recipients (max 5)</Label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (rows.length >= 5) return;
                  setRows((prev) => [
                    ...prev,
                    { id: randomId(), address: "", amount: "", delaySeconds: "", transferType: undefined },
                  ]);
                }}
                disabled={rows.length >= 5}
              >
                + Add recipient
              </Button>
            </div>

            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.id} className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="grid grid-cols-[1fr_120px_120px_36px] gap-2">
                    <Input
                      mono
                      placeholder={`Recipient ${idx + 1} address`}
                      value={r.address}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, address: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      placeholder="0.00"
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      placeholder="Delay (s)"
                      inputMode="numeric"
                      value={r.delaySeconds ?? ""}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, delaySeconds: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove recipient"
                      className="rounded-xl border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                      onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                      disabled={rows.length <= 1}
                      title={rows.length <= 1 ? "At least one recipient required" : "Remove"}
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <div>
                      Weight: {(summary.weights[idx] * 100).toFixed(1)}%{" "}
                      {r.amount ? "" : "(set amount to compute)"}
                    </div>
                    <div>
                      <select
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/80"
                        value={r.transferType ?? "inherit"}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id
                                ? {
                                    ...x,
                                    transferType:
                                      e.target.value === "inherit"
                                        ? undefined
                                        : (e.target.value as TransferType),
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="inherit">Inherit mode</option>
                        <option value="internal">Private</option>
                        <option value="external">External</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Delay between sends (sec)</Label>
                <Input inputMode="numeric" value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Extra random delay (sec)</Label>
                <Input inputMode="numeric" value={jitterSeconds} onChange={(e) => setJitterSeconds(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white/80">Transfer link</div>
            <Button variant="secondary" onClick={createTransferLink}>
              Create link
            </Button>
          </div>
          <Input
            mono
            placeholder="Generated link will appear here"
            value={transferLink}
            readOnly
          />
          <div className="text-xs text-white/40">
            Links prefill recipients and settings for quick sharing.
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-white/60">Transfer summary</div>
            <div className="text-xs text-white/40">
              Fee: {summary.fee.toFixed(6)} {token} ({(client.getFeePercentage(token) * 100).toFixed(2)}%)
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <div className="text-white/70">{summary.count} transfers</div>
            <div className="font-semibold text-white/90">
              Total: {summary.total.toFixed(6)} {token}
            </div>
          </div>
          {poolAvailable !== null && summary.total + summary.fee > poolAvailable ? (
            <div className="mt-2 text-xs text-red-200">
              Insufficient pool balance for this batch.
            </div>
          ) : null}
          {summary.total > 0 && summary.total < minimumAmount ? (
            <div className="mt-2 text-xs text-yellow-200">
              Total below minimum amount ({minimumAmount.toFixed(4)} {token}).
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
            {success}
          </div>
        ) : null}

        <Button
          type="button"
          size="lg"
          onClick={onSubmit}
          disabled={!walletAddress || !wasmReady || loading}
          className="w-full"
        >
          {loading ? "Processing…" : "Transfer"}
        </Button>
      </div>
    </Panel>
  );
}

export default function TransferPage() {
  return (
    <Suspense
      fallback={
        <Panel title="Private Transfer" subtitle="Loading transfer formâ€¦">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
            Loading transfer formâ€¦
          </div>
        </Panel>
      }
    >
      <TransferPageInner />
    </Suspense>
  );
}
