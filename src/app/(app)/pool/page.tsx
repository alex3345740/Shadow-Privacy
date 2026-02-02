"use client";

import { useEffect, useMemo, useState } from "react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/components/wallet-button";
import {
  SUPPORTED_TOKENS,
  TokenUtils,
  type TokenSymbol,
  type WithdrawResponse,
} from "@radr/shadowwire";
import { createShadowWireClient } from "@/lib/shadowwire";
import { pushHistory } from "@/lib/history";
import { addPendingAction, removePendingAction } from "@/lib/pending-actions";
import { errorMessage } from "@/lib/errors";
import { getSolBalance, getSplBalance } from "@/lib/solana";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast-provider";
import { PendingActionsPanel } from "@/components/pending-actions-panel";

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function randomId() {
  return Math.random().toString(16).slice(2);
}

function isUserRejected(error: unknown) {
  const err = error as { message?: string; name?: string; code?: number; data?: { message?: string } };
  const message = (err?.message ?? err?.data?.message ?? String(error)).toLowerCase();
  const name = (err?.name ?? "").toLowerCase();
  return (
    message.includes("user rejected") ||
    message.includes("user rejected the request") ||
    name.includes("walletsigntransactionerror") ||
    name.includes("walletsignmessageerror") ||
    err?.code === 4001
  );
}

export default function PoolPage() {
  const client = useMemo(() => createShadowWireClient(), []);
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { pushToast } = useToast();
  const walletAddress = publicKey?.toBase58() ?? null;

  const [token, setToken] = useState<TokenSymbol>("SOL");
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [poolDeposited, setPoolDeposited] = useState<number | null>(null);
  const [poolAddress, setPoolAddress] = useState<string | null>(null);
  const [migrated, setMigrated] = useState<boolean | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [lastDepositSig, setLastDepositSig] = useState<string | null>(null);
  const [lastWithdrawSig, setLastWithdrawSig] = useState<string | null>(null);

  const [loading, setLoading] = useState<null | "deposit" | "withdraw">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const tokenMint = TokenUtils.getTokenMint(token);

  async function refresh() {
    if (!walletAddress) {
      setPoolAvailable(null);
      setPoolDeposited(null);
      setPoolAddress(null);
      setMigrated(null);
      setWalletBalance(null);
      return;
    }
    try {
      const bal = await client.getBalance(walletAddress, token);
      setPoolAvailable(TokenUtils.fromSmallestUnit(bal.available, token));
      setPoolDeposited(TokenUtils.fromSmallestUnit(bal.deposited, token));
      setPoolAddress(bal.pool_address);
      setMigrated(bal.migrated);
      if (token === "SOL") {
        setWalletBalance(await getSolBalance(walletAddress));
      } else {
        const mint = TokenUtils.getTokenMint(token);
        if (mint && mint !== "Native") {
          setWalletBalance(await getSplBalance(walletAddress, mint));
        } else {
          setWalletBalance(null);
        }
      }
    } catch (e: unknown) {
      setMessage({ kind: "err", text: errorMessage(e) });
      setPoolAvailable(null);
      setPoolDeposited(null);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, token]);

  async function signAndSendBase64Tx(unsignedTxBase64: string): Promise<string | null> {
    if (!publicKey) throw new Error("Connect a Solana wallet first.");

    const raw = base64ToBytes(unsignedTxBase64);
    const confirmWith = async (signature: string, latest?: Awaited<ReturnType<typeof connection.getLatestBlockhash>>) => {
      const blockhash =
        latest ??
        (await connection.getLatestBlockhash("confirmed"));
      await connection.confirmTransaction(
        { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed",
      );
    };

    try {
      const vtx = VersionedTransaction.deserialize(raw);
      const hasSignature = vtx.signatures.some((sig) => sig.some((byte) => byte !== 0));
      let latest: Awaited<ReturnType<typeof connection.getLatestBlockhash>> | undefined;

      if (!hasSignature) {
        latest = await connection.getLatestBlockhash("confirmed");
        vtx.message.recentBlockhash = latest.blockhash;
      }

      if (signTransaction) {
        try {
          const signed = await signTransaction(vtx);
          const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
          await confirmWith(signature, latest);
          return signature;
        } catch (error) {
          if (isUserRejected(error)) return null;
          throw error;
        }
      }

      if (!sendTransaction) throw new Error("Wallet sendTransaction unavailable.");
      try {
        const signature = await sendTransaction(vtx, connection, { skipPreflight: false });
        await confirmWith(signature, latest);
        return signature;
      } catch (error) {
        if (isUserRejected(error)) return null;
        throw error;
      }
    } catch {
      const tx = Transaction.from(raw);
      if (!tx.feePayer) tx.feePayer = publicKey;
      const hasSignature = tx.signatures.some((sig) => sig.signature);
      let latest: Awaited<ReturnType<typeof connection.getLatestBlockhash>> | undefined;

      if (!hasSignature) {
        latest = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = latest.blockhash;
      }

      if (signTransaction) {
        try {
          const signed = await signTransaction(tx);
          const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
          await confirmWith(signature, latest);
          return signature;
        } catch (error) {
          if (isUserRejected(error)) return null;
          throw error;
        }
      }

      if (!sendTransaction) throw new Error("Wallet sendTransaction unavailable.");
      try {
        const signature = await sendTransaction(tx, connection, { skipPreflight: false });
        await confirmWith(signature, latest);
        return signature;
      } catch (error) {
        if (isUserRejected(error)) return null;
        throw error;
      }
    }
  }

  async function handleDeposit(): Promise<string | null> {
    if (!walletAddress) throw new Error("Connect a Solana wallet first.");
    const amountNum = Number(depositAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Invalid amount.");

    const amountSmallest = TokenUtils.toSmallestUnit(amountNum, token);
    const res = await client.deposit({
      wallet: walletAddress,
      amount: amountSmallest,
      token_mint: tokenMint === "Native" ? undefined : tokenMint,
    });

    return signAndSendBase64Tx(res.unsigned_tx_base64);
  }

  async function handleWithdraw(): Promise<string | null> {
    if (!walletAddress) throw new Error("Connect a Solana wallet first.");
    if (!signTransaction) {
      throw new Error("This wallet doesn't support signTransaction (needed for withdrawals).");
    }

    const amountNum = Number(withdrawAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error("Invalid amount.");

    const amountSmallest = TokenUtils.toSmallestUnit(amountNum, token);

    const first: WithdrawResponse = await client.withdraw({
      wallet: walletAddress,
      amount: amountSmallest,
      token_mint: tokenMint === "Native" ? undefined : tokenMint,
    });

    const unsigned = first.unsigned_tx_base64;
    if (!unsigned) {
      if (first.tx_signature) return first.tx_signature;
      throw new Error(first.error || "Withdraw failed (no unsigned tx).");
    }

    const tx = Transaction.from(base64ToBytes(unsigned));
    tx.feePayer = publicKey!;
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    let signedTx: Transaction;
    try {
      signedTx = await signTransaction(tx);
    } catch (error) {
      if (isUserRejected(error)) return null;
      throw error;
    }
    const signedBase64 = bytesToBase64(signedTx.serialize());

    const second = await client.withdraw({
      wallet: walletAddress,
      amount: amountSmallest,
      token_mint: tokenMint === "Native" ? undefined : tokenMint,
      signed_tx: signedBase64,
    });

    if (!second.success) throw new Error(second.error || "Withdraw failed.");
    if (second.tx_signature) return second.tx_signature;

    // Some environments may not return tx signature; send locally as a fallback.
    return signAndSendBase64Tx(signedBase64);
  }

  async function onDeposit() {
    setMessage(null);
    setLoading("deposit");
    const actionId = randomId();
    addPendingAction({
      id: actionId,
      createdAt: Date.now(),
      kind: "deposit",
      payload: { token, amount: depositAmount },
    });
    try {
      const sig = await handleDeposit();
      if (!sig) {
        setMessage({ kind: "err", text: "Transaction cancelled." });
        removePendingAction(actionId);
        pushToast({ title: "Deposit cancelled", description: "User rejected the transaction." });
        return;
      }
      setMessage({ kind: "ok", text: `Deposit confirmed: ${sig}` });
      setLastDepositSig(sig);
      pushHistory({
        id: randomId(),
        at: Date.now(),
        kind: "deposit",
        summary: `Deposit ${depositAmount || "?"} ${token}`,
        data: { token, sig },
        status: "success",
      });
      removePendingAction(actionId);
      pushToast({ title: "Deposit confirmed", description: sig, kind: "success" });
      setDepositAmount("");
      await refresh();
    } catch (e: unknown) {
      const messageText = errorMessage(e);
      setMessage({ kind: "err", text: messageText });
      removePendingAction(actionId);
      addPendingAction({
        id: actionId,
        createdAt: Date.now(),
        kind: "deposit",
        payload: { token, amount: depositAmount },
        lastError: messageText,
      });
      pushToast({ title: "Deposit failed", description: messageText, kind: "error" });
    } finally {
      setLoading(null);
    }
  }

  async function onWithdraw() {
    setMessage(null);
    setLoading("withdraw");
    const actionId = randomId();
    addPendingAction({
      id: actionId,
      createdAt: Date.now(),
      kind: "withdraw",
      payload: { token, amount: withdrawAmount },
    });
    try {
      const sig = await handleWithdraw();
      if (!sig) {
        setMessage({ kind: "err", text: "Transaction cancelled." });
        removePendingAction(actionId);
        pushToast({ title: "Withdraw cancelled", description: "User rejected the transaction." });
        return;
      }
      setMessage({ kind: "ok", text: `Withdraw confirmed: ${sig}` });
      setLastWithdrawSig(sig);
      pushHistory({
        id: randomId(),
        at: Date.now(),
        kind: "withdraw",
        summary: `Withdraw ${withdrawAmount || "?"} ${token}`,
        data: { token, sig },
        status: "success",
      });
      removePendingAction(actionId);
      pushToast({ title: "Withdraw confirmed", description: sig, kind: "success" });
      setWithdrawAmount("");
      await refresh();
    } catch (e: unknown) {
      const messageText = errorMessage(e);
      setMessage({ kind: "err", text: messageText });
      removePendingAction(actionId);
      addPendingAction({
        id: actionId,
        createdAt: Date.now(),
        kind: "withdraw",
        payload: { token, amount: withdrawAmount },
        lastError: messageText,
      });
      pushToast({ title: "Withdraw failed", description: messageText, kind: "error" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <Panel title="Pool" subtitle="Deposit into / withdraw from the ShadowWire pool." right={<WalletButton />}>
      <div className="space-y-5">
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
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs text-white/40">Pool balances</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-white/60">Available</div>
                <div className="font-semibold text-white/90">
                  {poolAvailable === null ? "—" : `${poolAvailable.toFixed(6)} ${token}`}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-white/60">Deposited</div>
                <div className="font-semibold text-white/90">
                  {poolDeposited === null ? "—" : `${poolDeposited.toFixed(6)} ${token}`}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-white/60">Wallet balance</div>
                <div className="font-semibold text-white/90">
                  {walletBalance === null ? "—" : `${walletBalance.toFixed(6)} ${token}`}
                </div>
              </div>
              {poolAddress ? (
                <div className="text-xs text-white/50">
                  Pool address: <span className="font-mono">{poolAddress}</span>
                </div>
              ) : null}
              {migrated !== null ? (
                <div className="text-xs text-white/50">
                  Migration status: {migrated ? "Migrated" : "Active"}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-white/80">Deposit</div>
            <div className="mt-3 space-y-2">
              <Label>Amount</Label>
              <Input
                placeholder={`0.0 ${token}`}
                inputMode="decimal"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-white/50 hover:text-white"
                  onClick={() => {
                    if (walletBalance !== null) setDepositAmount(walletBalance.toFixed(6));
                  }}
                >
                  Deposit max
                </button>
                {lastDepositSig ? (
                  <a
                    className="text-xs text-sky-300 hover:text-white"
                    href={`https://solscan.io/tx/${lastDepositSig}`}
                    target="_blank"
                  >
                    View last deposit
                  </a>
                ) : null}
              </div>
              <Button className="mt-2 w-full" onClick={onDeposit} disabled={!walletAddress || loading !== null}>
                {loading === "deposit" ? "Depositing…" : "Deposit"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-semibold text-white/80">Withdraw</div>
            <div className="mt-3 space-y-2">
              <Label>Amount</Label>
              <Input
                placeholder={`0.0 ${token}`}
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-white/50 hover:text-white"
                  onClick={() => {
                    if (poolAvailable !== null) setWithdrawAmount(poolAvailable.toFixed(6));
                  }}
                >
                  Withdraw max
                </button>
                {lastWithdrawSig ? (
                  <a
                    className="text-xs text-sky-300 hover:text-white"
                    href={`https://solscan.io/tx/${lastWithdrawSig}`}
                    target="_blank"
                  >
                    View last withdraw
                  </a>
                ) : null}
              </div>
              <Button
                className="mt-2 w-full"
                onClick={onWithdraw}
                disabled={!walletAddress || loading !== null}
              >
                {loading === "withdraw" ? "Withdrawing…" : "Withdraw"}
              </Button>
            </div>
          </div>
        </div>

        {message ? (
          <div
            className={`rounded-xl border p-3 text-sm ${
              message.kind === "ok"
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                : "border-red-500/20 bg-red-500/10 text-red-200"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <PendingActionsPanel />

        <Button variant="secondary" className="w-full" onClick={refresh} disabled={!walletAddress || loading !== null}>
          Refresh balances
        </Button>
      </div>
    </Panel>
  );
}
