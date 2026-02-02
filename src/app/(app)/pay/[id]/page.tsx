"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast-provider";
import { pushHistory } from "@/lib/history";

type Payment = {
  id: string;
  amountUsdc: number;
  sourceChain: string;
  sourceDomain: number;
  destinationWallet: string;
  label?: string;
  reference?: string;
  note?: string;
  autoDepositApproved?: boolean;
  sourceWalletAddress?: string;
  sourceCircleBlockchain?: string;
  status: string;
  sourceTxHash?: string;
  forwardTx?: string;
  depositTx?: string;
  error?: string;
};

export default function PayPage() {
  const params = useParams();
  const paymentId = String(params?.id ?? "");
  const { pushToast } = useToast();

  const [payment, setPayment] = useState<Payment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manualTx, setManualTx] = useState("");

  const status = payment?.status ?? "created";

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    async function fetchPayment() {
      if (!paymentId) return;
      const res = await fetch(`/api/payments/${paymentId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { payment: Payment };
      setPayment(data.payment);
    }

    fetchPayment();

    interval = setInterval(fetchPayment, 5000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [paymentId]);

  async function copyAddress() {
    if (!payment?.sourceWalletAddress) return;
    await navigator.clipboard.writeText(payment.sourceWalletAddress);
    setMessage("Deposit address copied.");
    pushToast({ title: "Address copied", description: "Deposit address copied." });
  }

  const statusLabel = useMemo(() => {
    switch (status) {
      case "created":
        return "Awaiting USDC transfer";
      case "awaiting_funds":
        return "Waiting for USDC deposit";
      case "awaiting_gas":
        return "Waiting for gas funding";
      case "burning":
        return "Burning USDC via CCTP";
      case "submitted":
        return "Transfer submitted";
      case "attestation_pending":
        return "Waiting for Circle attestation";
      case "attested":
        return "Attestation ready";
      case "forwarding":
        return "Forwarding to Solana";
      case "depositing":
        return "Depositing into ShadowWire pool";
      case "completed":
        return "Payment complete";
      case "failed":
        return "Payment failed";
      default:
        return status;
    }
  }, [status]);

  const steps = useMemo(
    () => [
      "created",
      "awaiting_funds",
      "awaiting_gas",
      "burning",
      "submitted",
      "attestation_pending",
      "attested",
      "forwarding",
      "depositing",
      "completed",
    ],
    [],
  );
  const currentIndex = steps.indexOf(status);

  async function submitBurnTx() {
    if (!manualTx.trim()) return;
    if (!/^0x[a-fA-F0-9]{64}$/.test(manualTx.trim())) {
      const err = "Enter a valid 0x-prefixed 32-byte transaction hash.";
      setMessage(err);
      pushToast({ title: "Invalid tx hash", description: err, kind: "error" });
      return;
    }
    try {
      const res = await fetch("/api/payments/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: paymentId, sourceTxHash: manualTx.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit tx hash.");
      }
      setMessage("Burn tx hash submitted.");
      pushToast({ title: "Burn tx submitted", description: manualTx.trim(), kind: "success" });
      pushHistory({
        id: Math.random().toString(16).slice(2),
        at: Date.now(),
        kind: "payment",
        summary: `Burn tx submitted (${manualTx.trim().slice(0, 10)}…)`,
        data: { paymentId, sourceTxHash: manualTx.trim() },
        status: "pending",
      });
      setManualTx("");
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      setMessage(err);
      pushToast({ title: "Submit failed", description: err, kind: "error" });
    }
  }

  return (
    <Panel title="Complete Payment" subtitle="Finalize a USDC payment that settles into ShadowWire.">
      <div className="space-y-6">
        {!payment ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
            Loading payment…
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-2 text-sm text-white/80">
              <div className="flex items-center justify-between">
                <div className="text-white/60">Amount</div>
                <div className="font-semibold">{payment.amountUsdc} USDC</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-white/60">Source chain</div>
                <div className="font-semibold">{payment.sourceChain}</div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-white/60">Destination wallet</div>
                <div className="font-mono text-xs text-white/70">{payment.destinationWallet}</div>
              </div>
              {payment.label ? (
                <div className="flex items-center justify-between">
                  <div className="text-white/60">Label</div>
                  <div className="text-xs text-white/80">{payment.label}</div>
                </div>
              ) : null}
              {payment.reference ? (
                <div className="flex items-center justify-between">
                  <div className="text-white/60">Reference</div>
                  <div className="text-xs text-white/80">{payment.reference}</div>
                </div>
              ) : null}
              {payment.note ? (
                <div className="text-xs text-white/50">Note: {payment.note}</div>
              ) : null}
              <div className="flex items-center justify-between">
                <div className="text-white/60">Status</div>
                <div className="font-semibold">{statusLabel}</div>
              </div>
              {payment.error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {payment.error}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Status timeline</div>
              <div className="grid gap-2 md:grid-cols-2">
                {steps.map((step, idx) => {
                  const active = currentIndex >= idx || status === "failed";
                  return (
                    <div
                      key={step}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        active
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-white/5 text-white/50"
                      }`}
                    >
                      {step.replace(/_/g, " ")}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">Send USDC to this address</div>
                <div className="text-xs text-white/50">
                  Deposit on {payment.sourceChain}. Funds are automatically bridged to Solana and deposited into the ShadowWire pool.
                </div>
                <div className="text-xs text-white/40">
                  Also send a small amount of native gas token to cover the CCTP burn transaction.
                </div>
              </div>
              <div className="flex gap-2">
                <Input mono readOnly value={payment.sourceWalletAddress ?? ""} />
                <Button variant="secondary" onClick={copyAddress} disabled={!payment.sourceWalletAddress}>
                  Copy
                </Button>
              </div>
              {payment.sourceTxHash ? (
                <div className="text-xs text-white/50">
                  CCTP burn tx: <span className="font-mono">{payment.sourceTxHash}</span>
                </div>
              ) : null}
              {payment.forwardTx ? (
                <div className="text-xs text-white/50">
                  Forwarding tx: <span className="font-mono">{payment.forwardTx}</span>
                </div>
              ) : null}
              {payment.depositTx ? (
                <div className="text-xs text-white/50">
                  Deposit tx: <span className="font-mono">{payment.depositTx}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Manual burn tx submission</div>
              <div className="text-xs text-white/50">
                If you already burned USDC and have a tx hash, submit it here to resume processing.
              </div>
              <div className="text-xs text-white/40">Format: 0x + 64 hex characters.</div>
              <div className="flex gap-2">
                <Input
                  mono
                  placeholder="0x burn tx hash"
                  value={manualTx}
                  onChange={(e) => setManualTx(e.target.value)}
                />
                <Button variant="secondary" onClick={submitBurnTx} disabled={!manualTx.trim()}>
                  Submit
                </Button>
              </div>
            </div>

            {message ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                {message}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}
