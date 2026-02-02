import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";
import { parseUnits } from "viem";
import { SOLANA_DOMAIN } from "@/lib/cctp";
import { getEvmChainByDomain } from "@/lib/cctp-evm";

type CircleResponse<T> = {
  data: T;
};

export type CircleBlockchain =
  | "ETH"
  | "AVAX"
  | "OP"
  | "ARB"
  | "BASE"
  | "MATIC";

const CIRCLE_API_BASE = process.env.CIRCLE_API_BASE ?? "https://api.circle.com";

const CIRCLE_CCTP_BLOCKCHAINS: Record<number, CircleBlockchain> = {
  0: "ETH",
  1: "AVAX",
  2: "OP",
  3: "ARB",
  6: "BASE",
  7: "MATIC",
};

function getApiKey() {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) {
    throw new Error("CIRCLE_API_KEY is not configured.");
  }
  return key;
}

function getEntitySecretCiphertext() {
  const secret = process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT;
  if (!secret) {
    throw new Error("CIRCLE_ENTITY_SECRET_CIPHERTEXT is not configured.");
  }
  return secret;
}

function getWalletSetId() {
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    throw new Error("CIRCLE_WALLET_SET_ID is not configured.");
  }
  return walletSetId;
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function circleFetchRaw(path: string, init?: RequestInit) {
  const response = await fetch(`${CIRCLE_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = parseJson(text);

  return { response, data, text };
}

async function circleRequest<T>(path: string, init?: RequestInit) {
  const { response, data, text } = await circleFetchRaw(path, init);
  if (!response.ok) {
    throw new Error(`Circle API error (${response.status}): ${text}`);
  }
  return data as CircleResponse<T>;
}

export function getCircleBlockchainByDomain(domain: number) {
  return CIRCLE_CCTP_BLOCKCHAINS[domain] ?? null;
}

export function solanaAddressToBytes32(address: string) {
  const pubkey = new PublicKey(address);
  return `0x${Buffer.from(pubkey.toBytes()).toString("hex")}` as `0x${string}`;
}

export async function createDeveloperWallet(params: { domain: number; refId?: string }) {
  const blockchain = getCircleBlockchainByDomain(params.domain);
  if (!blockchain) {
    throw new Error("Selected chain does not support Circle wallets.");
  }

  const payload = {
    idempotencyKey: crypto.randomUUID(),
    blockchains: [blockchain],
    entitySecretCiphertext: getEntitySecretCiphertext(),
    walletSetId: getWalletSetId(),
    accountType: "EOA",
    count: 1,
    metadata: params.refId ? [{ refId: params.refId }] : undefined,
  };

  const response = await circleRequest<{ wallets: { id: string; address: string }[] }>(
    "/v1/w3s/developer/wallets",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const wallet = response.data.wallets?.[0];
  if (!wallet) {
    throw new Error("Circle wallet creation returned no wallet.");
  }

  return {
    walletId: wallet.id,
    walletAddress: wallet.address,
    blockchain,
  };
}

async function tryWalletBalances(path: string) {
  const { response, data } = await circleFetchRaw(path);
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      return null;
    }
    throw new Error(`Circle balances error (${response.status})`);
  }
  return data as CircleResponse<{ tokenBalances: { amount: string; token: { symbol: string } }[] }>;
}

export async function getWalletUsdcBalance(walletId: string) {
  const paths = [
    `/v1/w3s/developer/wallets/${walletId}/balances`,
    `/v1/w3s/wallets/${walletId}/balances`,
    `/v1/wallets/${walletId}/balances`,
  ];

  let response: CircleResponse<{ tokenBalances: { amount: string; token: { symbol: string } }[] }> | null =
    null;

  for (const path of paths) {
    response = await tryWalletBalances(path);
    if (response) break;
  }

  if (!response) {
    throw new Error("Unable to retrieve wallet balances from Circle.");
  }

  const balances = response.data?.tokenBalances ?? [];
  const usdc = balances.find((balance) => balance.token?.symbol?.toUpperCase() === "USDC");
  return usdc ? Number(usdc.amount) : 0;
}

export async function listWalletTransactions(walletId: string) {
  const query = new URLSearchParams({ walletIds: walletId, order: "DESC", pageSize: "10" });
  const response = await circleRequest<{ transactions: { id: string; txHash?: string }[] }>(
    `/v1/transactions?${query.toString()}`,
  );
  return response.data?.transactions ?? [];
}

export async function getCircleTransaction(transactionId: string) {
  const response = await circleRequest<{ transaction: { id: string; state?: string; txHash?: string } }>(
    `/v1/transactions/${transactionId}`,
  );
  return response.data?.transaction ?? null;
}

export async function createContractExecution(params: {
  walletId: string;
  blockchain: CircleBlockchain;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: string[];
  refId?: string;
}) {
  const payload = {
    idempotencyKey: crypto.randomUUID(),
    walletId: params.walletId,
    blockchain: params.blockchain,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters,
    entitySecretCiphertext: getEntitySecretCiphertext(),
    feeLevel: "MEDIUM",
    refId: params.refId,
  };

  const response = await circleRequest<{ id: string }>(
    "/v1/w3s/developer/transactions/contractExecution",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  const transactionId = response.data?.id;
  if (!transactionId) {
    throw new Error("Circle contract execution did not return a transaction id.");
  }
  return transactionId;
}

export async function waitForTransactionHash(transactionId: string, options?: { pollMs?: number; maxAttempts?: number }) {
  const pollMs = options?.pollMs ?? 5000;
  const maxAttempts = options?.maxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tx = await getCircleTransaction(transactionId);
    if (tx?.txHash && (tx.state === "COMPLETE" || tx.state === "CONFIRMED" || tx.state === "SENT")) {
      return tx.txHash;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for Circle transaction hash.");
}

export async function executeCctpBurnFromWallet(params: {
  walletId: string;
  sourceDomain: number;
  destinationWallet: string;
  amountUsdc: number;
  blockchain: CircleBlockchain;
}) {
  const evmChain = getEvmChainByDomain(params.sourceDomain);
  if (!evmChain) {
    throw new Error("Unsupported CCTP domain for burn.");
  }

  const amount = parseUnits(String(params.amountUsdc), 6).toString();
  const mintRecipient = solanaAddressToBytes32(params.destinationWallet);
  const destinationCaller = `0x${"0".repeat(64)}`;
  const maxFee = process.env.CCTP_MAX_FEE ?? "0";
  const minFinalityThreshold = process.env.CCTP_MIN_FINALITY_THRESHOLD ?? "2000";

  const approveTxId = await createContractExecution({
    walletId: params.walletId,
    blockchain: params.blockchain,
    contractAddress: evmChain.usdcAddress,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [evmChain.tokenMessengerV2, amount],
    refId: `approve-${params.walletId}`,
  });

  await waitForTransactionHash(approveTxId);

  const burnTxId = await createContractExecution({
    walletId: params.walletId,
    blockchain: params.blockchain,
    contractAddress: evmChain.tokenMessengerV2,
    abiFunctionSignature:
      "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
    abiParameters: [
      amount,
      String(SOLANA_DOMAIN),
      mintRecipient,
      evmChain.usdcAddress,
      destinationCaller,
      maxFee,
      minFinalityThreshold,
    ],
    refId: `cctp-burn-${params.walletId}`,
  });

  return await waitForTransactionHash(burnTxId);
}
