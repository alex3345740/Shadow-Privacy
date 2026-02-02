"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";
import * as QRCode from "qrcode";
import { CCTP_USDC_CHAINS, getCctpChain } from "@/lib/cctp";
import { getEvmChainByDomain } from "@/lib/cctp-evm";
import { pushHistory } from "@/lib/history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast-provider";

type PaymentResponse = {
  payment: {
    id: string;
    amountUsdc: number;
    sourceDomain: number;
    sourceChain: string;
    destinationWallet: string;
    label?: string;
    reference?: string;
    note?: string;
    sourceWalletAddress?: string;
    status: string;
  };
  link: string;
};

function randomId() {
  return Math.random().toString(16).slice(2);
}

export default function CollectPage() {
  const { publicKey } = useWallet();
  const { pushToast } = useToast();
  const walletAddress = publicKey?.toBase58() ?? "";

  const [amount, setAmount] = useState("10");
  const [sourceDomain, setSourceDomain] = useState<number>(0);
  const [destinationWallet, setDestinationWallet] = useState(walletAddress);
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [rememberApproval, setRememberApproval] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!destinationWallet && walletAddress) {
      setDestinationWallet(walletAddress);
    }
  }, [walletAddress, destinationWallet]);

  useEffect(() => {
    if (!destinationWallet) return;
    const raw = window.localStorage.getItem("shadowprivacy.paymentApproval.v1");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed[destinationWallet]) {
        setAutoApprove(true);
      }
    } catch {
      // ignore
    }
  }, [destinationWallet]);

  const chainLabel = useMemo(() => {
    const chain = getCctpChain(sourceDomain);
    return chain ? chain.name : "Unknown";
  }, [sourceDomain]);

  const chainOptions = useMemo(
    () =>
      CCTP_USDC_CHAINS.map((chain) => ({
        ...chain,
        supported: Boolean(getEvmChainByDomain(chain.domain)),
      })),
    [],
  );

  const comingSoonChains = useMemo(
    () => chainOptions.filter((chain) => !chain.supported),
    [chainOptions],
  );

  useEffect(() => {
    if (!getEvmChainByDomain(sourceDomain)) {
      const firstSupported = chainOptions.find((chain) => chain.supported);
      if (firstSupported) setSourceDomain(firstSupported.domain);
    }
  }, [chainOptions, sourceDomain]);

  useEffect(() => {
    if (!link) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(link, { margin: 1, width: 280 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [link]);

  async function createPayment() {
    setMessage(null);
    setLink("");
    setQrDataUrl("");
    setLoading(true);
    try {
      if (!autoApprove) {
        throw new Error("Please approve automatic CCTP settlement and pool deposit first.");
      }
      const amountUsdc = Number(amount);
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        throw new Error("Enter a valid USDC amount.");
      }
      if (!getEvmChainByDomain(sourceDomain)) {
        throw new Error("Selected chain is coming soon. Choose a supported chain.");
      }

      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsdc,
          sourceDomain,
          destinationWallet: destinationWallet.trim(),
          label: label.trim() || undefined,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          autoDepositApproved: autoApprove,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create payment.");
      }

      const data = (await response.json()) as PaymentResponse;
      if (autoApprove && rememberApproval && destinationWallet.trim()) {
        const raw = window.localStorage.getItem("shadowprivacy.paymentApproval.v1");
        const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
        parsed[destinationWallet.trim()] = true;
        window.localStorage.setItem("shadowprivacy.paymentApproval.v1", JSON.stringify(parsed));
      }
      setLink(data.link);
      const walletInfo = data.payment.sourceWalletAddress
        ? ` Deposit address: ${data.payment.sourceWalletAddress}`
        : "";
      setMessage(`Payment link created for ${data.payment.amountUsdc} USDC on ${data.payment.sourceChain}.${walletInfo}`);
      pushHistory({
        id: randomId(),
        at: Date.now(),
        kind: "payment",
        summary: `Payment link ${data.payment.amountUsdc} USDC (${data.payment.sourceChain})`,
        data: {
          paymentId: data.payment.id,
          link: data.link,
          amountUsdc: data.payment.amountUsdc,
          sourceChain: data.payment.sourceChain,
          label: data.payment.label,
          reference: data.payment.reference,
          note: data.payment.note,
        },
        status: "success",
      });
      pushToast({
        title: "Payment link created",
        description: `${data.payment.amountUsdc} USDC on ${data.payment.sourceChain}`,
        kind: "success",
      });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      setMessage(err);
      pushToast({ title: "Payment link failed", description: err, kind: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setMessage("Link copied to clipboard.");
    pushToast({ title: "Link copied", description: "Payment link copied to clipboard." });
  }

  async function downloadQr() {
    if (!qrDataUrl) return;
    const linkEl = document.createElement("a");
    linkEl.href = qrDataUrl;
    linkEl.download = "shadowwire-payment-qr.png";
    document.body.appendChild(linkEl);
    linkEl.click();
    linkEl.remove();
  }

  return (
    <Panel
      title="Payment Collection"
      subtitle="Generate USDC payment links with CCTP v2 settlement into your ShadowWire pool."
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Amount (USDC)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="flex flex-wrap gap-2 text-xs text-white/50">
                {["10", "25", "50", "100", "250"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10"
                    onClick={() => setAmount(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Source chain</Label>
              <select
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/90 outline-none focus:border-sky-400/40"
                value={String(sourceDomain)}
                onChange={(e) => setSourceDomain(Number(e.target.value))}
              >
                {chainOptions.map((chain) => (
                  <option key={chain.domain} value={chain.domain} disabled={!chain.supported}>
                    {chain.name}{chain.supported ? "" : " (soon)"}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/40">
                Selected chain: {chainLabel}{" "}
                {getEvmChainByDomain(sourceDomain) ? "(supported)" : "(coming soon)"}
              </div>
              {comingSoonChains.length > 0 ? (
                <div className="text-xs text-white/30">
                  Coming soon: {comingSoonChains.map((chain) => chain.name).join(", ")}
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Invoice label"
              />
            </div>
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Order ID"
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional memo" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Destination Solana wallet (pool owner)</Label>
            <Input
              mono
              value={destinationWallet}
              onChange={(e) => setDestinationWallet(e.target.value)}
              placeholder="Solana wallet address"
            />
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/60 space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
              />
              I approve automatic CCTP settlement and deposit into the ShadowWire pool.
            </label>
            <label className="flex items-center gap-2 text-white/40">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={rememberApproval}
                onChange={(e) => setRememberApproval(e.target.checked)}
                disabled={!autoApprove}
              />
              Remember approval for this destination wallet.
            </label>
          </div>
          <Button className="w-full" size="lg" onClick={createPayment} disabled={loading || !autoApprove}>
            {loading ? "Generating link…" : "Generate payment link"}
          </Button>
        </div>

        {message ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
            {message}
          </div>
        ) : null}

        {link ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-5 space-y-4">
            <div className="space-y-2">
              <Label>Payment link</Label>
              <div className="flex gap-2">
                <Input mono value={link} readOnly />
                <Button variant="secondary" onClick={copyLink}>
                  Copy
                </Button>
                <Button variant="ghost" onClick={() => window.open(link, "_blank")}>
                  Open
                </Button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[280px_1fr] items-start">
              <div className="flex items-center justify-center rounded-xl border border-white/10 bg-black/30 p-4">
                {qrDataUrl ? (
                  <div className="space-y-2">
                    <Image
                      src={qrDataUrl}
                      alt="Payment QR Code"
                      width={240}
                      height={240}
                      className="h-[240px] w-[240px]"
                      unoptimized
                    />
                    <Button variant="secondary" className="w-full" onClick={downloadQr}>
                      Download QR
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-white/40">Generating QR…</div>
                )}
              </div>
              <div className="space-y-2 text-sm text-white/70">
                <div className="font-semibold text-white">Share with payer</div>
                <div>
                  The payer opens the link, sends USDC to the generated wallet address, and the
                  system completes the CCTP bridge into Solana then deposits to the ShadowWire pool.
                </div>
                <div>
                  The deposit wallet must also receive a small amount of the chain&apos;s native gas token
                  to execute the burn transaction.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
