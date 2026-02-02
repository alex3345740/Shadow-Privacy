"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { WalletButton } from "@/components/wallet-button";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  OUTPUT_LIMIT,
  useSilentSwap,
  useSwap,
} from "@silentswap/react";
import {
  SB58_CHAIN_ID_SOLANA_MAINNET,
  caip19NativeSolanaToken,
  caip19SplToken,
  COMMON_ASSETS,
  getAddressFromCaip10,
  getAssetByCaip19,
  getAllAssetsArray,
  getChainName,
  isValidEvmAddress,
  isValidSolanaAddress,
  type Caip19,
  type AssetInfo,
} from "@silentswap/sdk";
import {
  SUPPORTED_TOKENS,
  TokenUtils,
  type TokenSymbol,
} from "@radr/shadowwire";
import { createShadowWireClient } from "@/lib/shadowwire";
import { pushHistory } from "@/lib/history";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast-provider";

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

function getSplitWeights(splits: number[], count: number): number[] {
  if (count <= 0) return [];
  const normalized = splits.slice(0, count);
  if (normalized.length === 0) return Array.from({ length: count }, () => 1 / count);
  const s = [...normalized];
  s[count - 1] = 1;
  const weights: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const prev = i === 0 ? 0 : s[i - 1] ?? 0;
    const curr = s[i] ?? 1;
    weights.push(Math.max(0, curr - prev));
  }
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => w / total);
}

function weightsToSplits(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const safe = sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / weights.length);
  const splits: number[] = [];
  let acc = 0;
  for (let i = 0; i < safe.length; i += 1) {
    acc += safe[i] ?? 0;
    splits.push(i === safe.length - 1 ? 1 : Math.min(1, Math.max(0, acc)));
  }
  return splits;
}

type AssetOption = {
  caip19: string;
  symbol: string;
  name: string;
  chain: string;
  tokenLabel: string;
  search: string;
};

const DEFAULT_DEST_ASSET =
  "eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function shortTokenId(value: string) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function getChainLabel(caip19: string) {
  if (caip19.startsWith("solana:")) return "Solana";
  const match = caip19.match(/^eip155:(\d+)\//);
  if (match) {
    const name = getChainName(match[1]);
    return name || `EVM ${match[1]}`;
  }
  return "Unknown";
}

function getTokenLabel(caip19: string) {
  const tokenPart = caip19.split("/")[1] ?? "";
  if (!tokenPart) return "";
  if (tokenPart.startsWith("erc20:")) return shortTokenId(tokenPart.replace("erc20:", ""));
  if (tokenPart.startsWith("token:")) return shortTokenId(tokenPart.replace("token:", ""));
  if (tokenPart.startsWith("spl:")) return shortTokenId(tokenPart.replace("spl:", ""));
  if (tokenPart.startsWith("slip44:")) return "Native";
  return tokenPart;
}

function isSupportedDestinationAsset(caip19: string) {
  return caip19.startsWith("eip155:") || caip19.startsWith("solana:");
}

function buildAssetOption(asset: AssetInfo): AssetOption {
  const chain = getChainLabel(asset.caip19);
  const tokenLabel = getTokenLabel(asset.caip19);
  const search = `${asset.symbol} ${asset.name} ${chain} ${asset.caip19} ${tokenLabel}`.toLowerCase();
  return {
    caip19: asset.caip19,
    symbol: asset.symbol,
    name: asset.name,
    chain,
    tokenLabel,
    search,
  };
}

const ALL_ASSET_OPTIONS = getAllAssetsArray()
  .filter((asset) => isSupportedDestinationAsset(asset.caip19))
  .map(buildAssetOption)
  .sort((a, b) => {
    const chainCompare = a.chain.localeCompare(b.chain);
    if (chainCompare !== 0) return chainCompare;
    return a.symbol.localeCompare(b.symbol);
  });

const POPULAR_ASSET_OPTIONS = COMMON_ASSETS
  .filter((asset) => isSupportedDestinationAsset(asset.caip19))
  .map(buildAssetOption);

const ASSET_OPTIONS_BY_CAIP19 = new Map(
  ALL_ASSET_OPTIONS.map((option) => [option.caip19, option]),
);

function getAssetLabel(caip19: string) {
  const option = ASSET_OPTIONS_BY_CAIP19.get(caip19);
  if (!option) return "Custom asset";
  return `${option.symbol} (${option.chain})`;
}

function filterAssetOptions(query: string, chainFilter?: string) {
  const trimmed = query.trim().toLowerCase();
  const pool = chainFilter
    ? ALL_ASSET_OPTIONS.filter((option) => option.chain === chainFilter)
    : ALL_ASSET_OPTIONS;
  const popularPool = chainFilter
    ? POPULAR_ASSET_OPTIONS.filter((option) => option.chain === chainFilter)
    : POPULAR_ASSET_OPTIONS;
  if (!trimmed) return popularPool.slice(0, 16);
  return pool.filter((option) => option.search.includes(trimmed)).slice(0, 40);
}

function DestinationAssetSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chainFilter, setChainFilter] = useState("All");

  const chainOptions = useMemo(() => {
    const unique = Array.from(new Set(ALL_ASSET_OPTIONS.map((option) => option.chain)));
    return ["All", ...unique];
  }, []);

  const options = useMemo(
    () => filterAssetOptions(query, chainFilter === "All" ? undefined : chainFilter),
    [query, chainFilter],
  );
  const selected = ASSET_OPTIONS_BY_CAIP19.get(value);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/90 outline-none transition focus:border-sky-400/40"
      >
        <span>{getAssetLabel(value)}</span>
        <span className="text-xs text-white/40">
          {selected?.tokenLabel ?? "CAIP-19"}
        </span>
      </button>
      {open ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search token, chain, or CAIP-19"
          />
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
            {chainOptions.map((chain) => (
              <button
                key={chain}
                type="button"
                onClick={() => setChainFilter(chain)}
                className={`rounded-full border px-3 py-1 ${
                  chainFilter === chain
                    ? "border-sky-400/50 bg-sky-400/20 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {chain}
              </button>
            ))}
          </div>
          <div className="mt-2 max-h-52 space-y-1 overflow-auto">
            {options.map((option) => (
              <button
                key={option.caip19}
                type="button"
                onClick={() => {
                  onChange(option.caip19);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between rounded-lg border border-transparent bg-white/5 px-3 py-2 text-left text-sm text-white/80 hover:border-sky-400/40 hover:bg-white/10"
              >
                <div>
                  <div className="font-semibold">
                    {option.symbol} <span className="text-xs text-white/50">({option.chain})</span>
                  </div>
                  <div className="text-xs text-white/40">{option.name}</div>
                </div>
                <div className="text-xs text-white/40">{option.tokenLabel}</div>
              </button>
            ))}
            {options.length === 0 ? (
              <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-white/40">
                No matches. Enter a CAIP-19 manually below.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function inferRecipientInput(contact: string) {
  const trimmed = contact.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("caip10:")) return getAddressFromCaip10(trimmed);
  return trimmed;
}

function toCaip10(assetCaip19: string, contact: string) {
  const trimmed = contact.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("caip10:")) return trimmed;
  const t = getRecipientType(assetCaip19);
  if (t === "evm") {
    const chainId = assetCaip19.split(":")[1]?.split("/")[0] ?? "1";
    return `caip10:eip155:${chainId}:${trimmed}`;
  }
  if (t === "solana") {
    return `caip10:solana:*:${trimmed}`;
  }
  return trimmed;
}

function getRecipientType(assetCaip19: string) {
  if (assetCaip19.startsWith("solana:")) return "solana";
  if (assetCaip19.startsWith("eip155:")) return "evm";
  return "unknown";
}

function validateRecipient(assetCaip19: string, recipient: string): string | null {
  const t = getRecipientType(assetCaip19);
  if (!recipient.trim()) return "Recipient is required.";
  if (t === "evm" && !isValidEvmAddress(recipient.trim())) return "Invalid EVM address.";
  if (t === "solana" && !isValidSolanaAddress(recipient.trim())) return "Invalid Solana address.";
  return null;
}

function tokenSymbolToSourceAsset(token: TokenSymbol): Caip19 {
  const mint = TokenUtils.getTokenMint(token);
  if (mint === "Native") return caip19NativeSolanaToken(SB58_CHAIN_ID_SOLANA_MAINNET);
  return caip19SplToken(SB58_CHAIN_ID_SOLANA_MAINNET, mint);
}

export function PoolMultiChainSwap() {
  const swClient = useMemo(() => createShadowWireClient(), []);
  const { pushToast } = useToast();

  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const solAddress = publicKey?.toBase58();


  const {
    executeSwap,
    isSwapping,
    swapLoading,
    currentStep,
    swapError,
    orderId,
    orderComplete,
    orderStatusTexts,
    orderProgresses,
    orderOutputs,
    serviceFeeUsd,
    bridgeFeeIngressUsd,
    bridgeFeeEgressUsd,
    slippageUsd,
    overheadUsd,
    egressEstimatesLoading,
    fetchEstimates,
    handleNewSwap,
  } = useSilentSwap();

  const tokenIn = useSwap((s) => s.tokenIn);
  const setTokenIn = useSwap((s) => s.setTokenIn);
  const inputAmount = useSwap((s) => s.inputAmount);
  const setInputAmount = useSwap((s) => s.setInputAmount);
  const slippage = useSwap((s) => s.slippage);
  const setSlippage = useSwap((s) => s.setSlippage);
  const isAutoSlippage = useSwap((s) => s.isAutoSlippage);
  const setIsAutoSlippage = useSwap((s) => s.setIsAutoSlippage);
  const privacyEnabled = useSwap((s) => s.privacyEnabled);
  const setPrivacyEnabled = useSwap((s) => s.setPrivacyEnabled);
  const destinations = useSwap((s) => s.destinations);
  const splits = useSwap((s) => s.splits);
  const setSplits = useSwap((s) => s.setSplits);
  const updateDestinationAsset = useSwap((s) => s.updateDestinationAsset);
  const updateDestinationContact = useSwap((s) => s.updateDestinationContact);
  const handleAddOutput = useSwap((s) => s.handleAddOutput);
  const handleDeleteOutput = useSwap((s) => s.handleDeleteOutput);

  const [sourceToken, setSourceToken] = useState<TokenSymbol>("SOL");
  const [usePoolFunds, setUsePoolFunds] = useState(true);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [lastEstimateAt, setLastEstimateAt] = useState<number | null>(null);
  const [lastCompletedOrder, setLastCompletedOrder] = useState<string | null>(null);

  const sourceAsset = useMemo(() => tokenSymbolToSourceAsset(sourceToken), [sourceToken]);
  const sourceAssetInfo: AssetInfo | undefined = useMemo(
    () => getAssetByCaip19(sourceAsset),
    [sourceAsset],
  );

  useEffect(() => {
    if (sourceAssetInfo) setTokenIn(sourceAssetInfo);
  }, [setTokenIn, sourceAssetInfo]);

  async function refreshPoolBalance() {
    if (!solAddress) {
      setPoolAvailable(null);
      return;
    }
    try {
      const bal = await swClient.getBalance(solAddress, sourceToken);
      setPoolAvailable(TokenUtils.fromSmallestUnit(bal.available, sourceToken));
    } catch {
      setPoolAvailable(null);
    }
  }

  useEffect(() => {
    refreshPoolBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solAddress, sourceToken]);

  async function withdrawFromPool(amountHuman: string) {
    if (!solAddress) throw new Error("Connect a Solana wallet first.");
    if (!signTransaction) throw new Error("Wallet must support signTransaction.");

    const amt = Number(amountHuman);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error("Invalid amount.");

    const tokenMint = TokenUtils.getTokenMint(sourceToken);
    const amountSmallest = TokenUtils.toSmallestUnit(amt, sourceToken);

    const first = await swClient.withdraw({
      wallet: solAddress,
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
    const signedTx = await signTransaction(tx);
    const signedBase64 = bytesToBase64(signedTx.serialize());

    const second = await swClient.withdraw({
      wallet: solAddress,
      amount: amountSmallest,
      token_mint: tokenMint === "Native" ? undefined : tokenMint,
      signed_tx: signedBase64,
    });

    if (!second.success) throw new Error(second.error || "Withdraw failed.");
    return second.tx_signature || "submitted";
  }

  async function onExecute() {
    setMessage(null);
    try {
      if (!solAddress) throw new Error("Connect a Solana wallet.");
      if (!tokenIn) throw new Error("Select a supported source token.");
      if (!inputAmount || Number(inputAmount) <= 0) throw new Error("Enter an amount.");

      const recipientErrors = destinations
        .map((d) => validateRecipient(d.asset, inferRecipientInput(d.contact)))
        .filter((e): e is string => !!e);
      if (recipientErrors.length > 0) {
        throw new Error(recipientErrors[0]);
      }

      if (usePoolFunds) {
        await refreshPoolBalance();
        if (poolAvailable !== null && Number(inputAmount) > poolAvailable) {
          throw new Error("Insufficient ShadowWire pool balance for this swap.");
        }
        await withdrawFromPool(inputAmount);
      }

      const normalizedDestinations = destinations.map((d) => ({
        ...d,
        contact: toCaip10(d.asset, d.contact),
      }));

      const result = await executeSwap({
        sourceAsset: tokenIn.caip19,
        sourceAmount: inputAmount,
        destinations: normalizedDestinations,
        splits: normalizedSplits,
        senderContactId: `caip10:solana:*:${solAddress}`,
        integratorId: process.env.NEXT_PUBLIC_INTEGRATOR_ID,
      });

      if (result) {
        setMessage({ kind: "ok", text: `Swap started (orderId: ${result.orderId}).` });
        pushHistory({
          id: Math.random().toString(16).slice(2),
          at: Date.now(),
          kind: "swap",
          summary: `Multi-chain swap ${inputAmount} ${sourceToken} to ${destinations.length} recipients`,
          data: {
            orderId: result.orderId,
            sourceToken,
            sourceAsset: tokenIn.caip19,
            destinations,
          },
          status: "pending",
        });
        pushToast({
          title: "Swap started",
          description: `Order ${result.orderId}`,
          kind: "success",
        });
      } else {
        setMessage({ kind: "ok", text: "Swap submitted." });
        pushToast({ title: "Swap submitted", description: "Order is processing." });
      }
    } catch (e: unknown) {
      const msg = errorMessage(e);
      setMessage({ kind: "err", text: msg });
      pushToast({ title: "Swap failed", description: msg, kind: "error" });
    }
  }

  const weights = useMemo(
    () => getSplitWeights(splits, destinations.length),
    [destinations.length, splits],
  );
  const normalizedSplits = useMemo(() => weightsToSplits(weights), [weights]);
  const totalEstimated = useMemo(() => {
    return destinations.reduce((sum, dest) => {
      const value = Number(dest.amount || "0");
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [destinations]);
  const estimateAge = useMemo(() => {
    if (!lastEstimateAt) return null;
    return Math.max(0, Math.round((Date.now() - lastEstimateAt) / 1000));
  }, [lastEstimateAt]);

  const estimateKey = useMemo(() => {
    const assetsKey = destinations.map((d) => d.asset).join("|");
    const splitsKey = splits.join("|");
    return `${tokenIn?.caip19 ?? "none"}:${inputAmount ?? ""}:${assetsKey}:${splitsKey}`;
  }, [destinations, inputAmount, splits, tokenIn?.caip19]);

  const requiresSolanaWallet = useMemo(
    () => (tokenIn?.caip19 ?? "").startsWith("solana:"),
    [tokenIn?.caip19],
  );
  const hasInvalidRecipients = useMemo(
    () =>
      destinations.some((d) => !!validateRecipient(d.asset, inferRecipientInput(d.contact))),
    [destinations],
  );

  const fetchEstimatesRef = useRef(fetchEstimates);
  useEffect(() => {
    fetchEstimatesRef.current = fetchEstimates;
  }, [fetchEstimates]);

  useEffect(() => {
    if (!tokenIn || !inputAmount || Number(inputAmount) <= 0) return;
    if (destinations.length === 0) return;
    if (requiresSolanaWallet && !solAddress) return;
    if (hasInvalidRecipients) return;
    if (egressEstimatesLoading) return;

    const timer = setTimeout(() => {
      fetchEstimatesRef
        .current?.()
        .then(() => setLastEstimateAt(Date.now()))
        .catch(() => {
          /* ignore estimate errors; UI will show "—" until valid */
        });
    }, 900);

    return () => clearTimeout(timer);
  }, [
    estimateKey,
    destinations.length,
    egressEstimatesLoading,
    hasInvalidRecipients,
    inputAmount,
    requiresSolanaWallet,
    solAddress,
    tokenIn,
  ]);

  useEffect(() => {
    if (!orderComplete || !orderId) return;
    if (orderId === lastCompletedOrder) return;
    pushHistory({
      id: Math.random().toString(16).slice(2),
      at: Date.now(),
      kind: "swap",
      summary: `Swap complete ${inputAmount} ${sourceToken}`,
      data: {
        orderId,
        sourceToken,
        sourceAsset: tokenIn?.caip19,
        destinations,
      },
      status: "success",
    });
    pushToast({ title: "Swap complete", description: `Order ${orderId}`, kind: "success" });
    setLastCompletedOrder(orderId);
  }, [orderComplete, orderId, lastCompletedOrder, inputAmount, sourceToken, tokenIn, destinations, pushToast]);

  function setWeightPercent(index: number, pctStr: string) {
    const pct = Number(pctStr);
    if (!Number.isFinite(pct)) return;

    const current = getSplitWeights(splits, destinations.length);
    const nextWeights = [...current];
    nextWeights[index] = Math.max(0, pct / 100);
    const nextSplits = weightsToSplits(nextWeights);
    setSplits(nextSplits);
  }

  function randomizeSplits() {
    if (destinations.length <= 1) return;
    const weights = destinations.map(() => Math.random() + 0.05);
    setSplits(weightsToSplits(weights));
  }

  return (
    <Panel
      title="Multi-chain Swap"
      subtitle="SilentSwap private swap with multiple recipients. Source funded from your ShadowWire pool."
      right={<WalletButton />}
    >
      <div className="space-y-5">

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Source token (ShadowWire pool)</Label>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/90 outline-none focus:border-sky-400/40"
              value={sourceToken}
              onChange={(e) => setSourceToken(e.target.value as TokenSymbol)}
            >
              {SUPPORTED_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="text-xs text-white/40">
              {poolAvailable === null ? "Pool available: —" : `Pool available: ${poolAvailable.toFixed(6)} ${sourceToken}`}
            </div>
            {!sourceAssetInfo ? (
              <div className="text-xs text-red-200/80">
                This token is not supported by SilentSwap (missing asset metadata).
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              inputMode="decimal"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder={`0.0 ${sourceToken}`}
            />
            <label className="mt-1 flex items-center gap-2 text-xs text-white/50">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={usePoolFunds}
                onChange={(e) => setUsePoolFunds(e.target.checked)}
                disabled={isSwapping || swapLoading}
              />
              Auto-withdraw from pool before swap
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <div className="text-xs font-semibold text-white/60">Recipients</div>
          <div className="mt-3 space-y-3">
            {destinations.map((d, idx) => {
              const recipientInput = inferRecipientInput(d.contact);
              const recipientErr = validateRecipient(d.asset, recipientInput);
              return (
                <div key={`${idx}-${d.asset}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="grid grid-cols-[1fr_120px_36px] items-end gap-2">
                    <div className="space-y-2">
                      <Label>Destination token</Label>
                      <DestinationAssetSelector
                        value={d.asset}
                        onChange={(value) => updateDestinationAsset(idx, value)}
                        disabled={isSwapping || swapLoading}
                      />
                      <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/50">
                        <summary className="cursor-pointer">Custom CAIP-19</summary>
                        <div className="mt-2">
                          <Input
                            mono
                            value={d.asset}
                            onChange={(e) => updateDestinationAsset(idx, e.target.value)}
                            placeholder="eip155:1/erc20:0x… or solana:…"
                          />
                        </div>
                      </details>
                    </div>

                    <div className="space-y-2">
                      <Label>Split (%)</Label>
                      <Input
                        inputMode="decimal"
                        value={((weights[idx] ?? 0) * 100).toFixed(2)}
                        onChange={(e) => setWeightPercent(idx, e.target.value)}
                      />
                    </div>

                    <button
                      type="button"
                      aria-label="Remove recipient"
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-40"
                      onClick={() => handleDeleteOutput(idx)}
                      disabled={destinations.length <= 1}
                      title={destinations.length <= 1 ? "At least one recipient required" : "Remove"}
                    >
                      ×
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Recipient address</Label>
                      <Input
                        mono
                        value={recipientInput}
                        onChange={(e) => updateDestinationContact(idx, e.target.value)}
                        placeholder={getRecipientType(d.asset) === "solana" ? "Solana address" : "0x..."}
                      />
                      {recipientErr ? (
                        <div className="text-xs text-red-200/80">{recipientErr}</div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label>Est. output</Label>
                      <div className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/70 flex items-center">
                        {d.amount || "—"}
                      </div>
                      <div className="text-xs text-white/40">
                        Amounts auto-update from SilentSwap estimates.
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAddOutput(DEFAULT_DEST_ASSET, "")}
              disabled={destinations.length >= OUTPUT_LIMIT || isSwapping || swapLoading}
            >
              + Add recipient
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSplits(weightsToSplits(Array.from({ length: destinations.length }, () => 1)))}
                disabled={destinations.length <= 1 || isSwapping || swapLoading}
              >
                Equal split
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={randomizeSplits}
                disabled={destinations.length <= 1 || isSwapping || swapLoading}
              >
                Randomize
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <div className="text-xs font-semibold text-white/60">Swap settings</div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Slippage</Label>
              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  value={slippage.toFixed(2)}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value)) setSlippage(value);
                  }}
                  disabled={isAutoSlippage}
                />
                <label className="flex items-center gap-2 text-xs text-white/50">
                  <input
                    type="checkbox"
                    className="accent-sky-400"
                    checked={isAutoSlippage}
                    onChange={(e) => setIsAutoSlippage(e.target.checked)}
                  />
                  Auto
                </label>
              </div>
              <div className="text-xs text-white/40">
                Estimated outputs update automatically. Last update:{" "}
                {estimateAge !== null ? `${estimateAge}s ago` : "â€”"}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Privacy mode</Label>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  className="accent-sky-400"
                  checked={privacyEnabled}
                  onChange={(e) => setPrivacyEnabled(e.target.checked)}
                />
                Enable privacy routing
              </label>
              <div className="text-xs text-white/40">
                When enabled, SilentSwap uses private routing and shielding.
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-white/50">
            <div>Total estimated output</div>
            <div className="text-white/80">
              {totalEstimated > 0 ? totalEstimated.toFixed(4) : "â€”"}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
          <div className="text-xs font-semibold text-white/60">Fees (est.)</div>
          <div className="mt-2 space-y-1 text-white/80">
            <div className="flex items-center justify-between">
              <div className="text-white/60">Service fee</div>
              <div className="font-semibold">${serviceFeeUsd.toFixed(2)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-white/60">Bridge ingress</div>
              <div className="font-semibold">${bridgeFeeIngressUsd.toFixed(2)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-white/60">Bridge egress</div>
              <div className="font-semibold">${bridgeFeeEgressUsd.toFixed(2)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-white/60">Slippage</div>
              <div className="font-semibold">-${slippageUsd.toFixed(2)}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-white/60">Overhead</div>
              <div className="font-semibold">${overheadUsd.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {(isSwapping || swapLoading) && (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/80">
            <div className="text-xs font-semibold text-white/60">Status</div>
            <div className="mt-2 font-semibold">{currentStep || "Processing…"}</div>
            {orderStatusTexts.length > 0 ? (
              <div className="mt-3 space-y-2">
                {orderStatusTexts.map((t, i) => (
                  <div key={String(i)} className="flex items-center justify-between gap-3 text-xs text-white/60">
                    <div className="truncate">{t}</div>
                    <div className="w-20 text-right">
                      {orderProgresses[i] !== undefined ? `${Math.round((orderProgresses[i] ?? 0) * 100)}%` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {orderOutputs.length > 0 ? (
              <div className="mt-3 space-y-2 text-xs text-white/60">
                {orderOutputs.map((output) => (
                  <div key={String(output.index)} className="flex items-center justify-between gap-3">
                    <div className="truncate">
                      Output #{output.index + 1} â€” {output.asset?.amount ?? "â€”"}{" "}
                      {output.asset?.caip19 ?? ""}
                    </div>
                    <div className="text-white/40">{output.stage}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {swapError ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {swapError.message}
          </div>
        ) : null}
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

        {orderComplete && orderId ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
            <div className="font-semibold">Swap complete</div>
            <div className="mt-1 font-mono text-[12px]">Order ID: {orderId}</div>
            <Button className="mt-3 w-full" variant="secondary" onClick={handleNewSwap}>
              New swap
            </Button>
          </div>
        ) : (
          <Button
            className="w-full"
            size="lg"
            onClick={onExecute}
            disabled={
              !sourceAssetInfo ||
              !tokenIn ||
              !solAddress ||
              isSwapping ||
              swapLoading ||
              egressEstimatesLoading
            }
          >
            {egressEstimatesLoading ? "Fetching estimates…" : isSwapping ? "Swapping…" : "Execute swap"}
          </Button>
        )}
      </div>
    </Panel>
  );
}
