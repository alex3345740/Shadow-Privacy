import { ShadowWireClient, TokenUtils } from "@radr/shadowwire";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { createShadowWireClient } from "@/lib/shadowwire";

export type CctpChain = {
  domain: number;
  name: string;
  type: "evm" | "solana" | "starknet";
  usdcSupported: boolean;
  mainnet: boolean;
};

export const CCTP_USDC_CHAINS: CctpChain[] = [
  { domain: 0, name: "Ethereum", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 1, name: "Avalanche", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 2, name: "OP Mainnet", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 3, name: "Arbitrum", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 5, name: "Solana", type: "solana", usdcSupported: true, mainnet: true },
  { domain: 6, name: "Base", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 7, name: "Polygon PoS", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 10, name: "Unichain", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 11, name: "Linea", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 12, name: "Codex", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 13, name: "Sonic", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 14, name: "World Chain", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 15, name: "Monad", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 16, name: "Sei", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 18, name: "XDC", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 19, name: "HyperEVM", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 21, name: "Ink", type: "evm", usdcSupported: true, mainnet: true },
  { domain: 22, name: "Plume", type: "evm", usdcSupported: true, mainnet: true },
];

export const SOLANA_DOMAIN = 5;

export function getCctpChain(domain: number) {
  return CCTP_USDC_CHAINS.find((chain) => chain.domain === domain);
}

export type AttestationMessage = {
  message: string;
  attestation: string;
  status?: string;
  decodedMessageBody?: {
    amount?: string;
    mintRecipient?: string;
    burnToken?: string;
  };
  decodedMessage?: {
    sourceDomain?: string;
    destinationDomain?: string;
  };
};

export async function waitForAttestation(
  sourceDomain: number,
  transactionHash: string,
  options?: { pollIntervalMs?: number; maxAttempts?: number },
): Promise<AttestationMessage> {
  const pollIntervalMs = options?.pollIntervalMs ?? 5000;
  const maxAttempts = options?.maxAttempts ?? 60;
  const irisBase = process.env.CIRCLE_IRIS_BASE_URL ?? "https://iris-api.circle.com";
  const url = `${irisBase}/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as { messages?: AttestationMessage[] };
      const msg = data.messages?.[0];
      if (msg?.status === "complete" && msg.attestation && msg.message) {
        return msg;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for Circle attestation.");
}

type ForwarderResponse = {
  signature?: string;
  transaction?: string;
};

export async function forwardToSolana(
  message: AttestationMessage,
  recipient: string,
): Promise<ForwarderResponse> {
  const forwarderUrl = process.env.CCTP_SOLANA_FORWARDER_URL;
  if (!forwarderUrl) {
    throw new Error("CCTP_SOLANA_FORWARDER_URL is not configured.");
  }
  const response = await fetch(forwarderUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message.message,
      attestation: message.attestation,
      recipient,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Solana forwarder failed: ${text}`);
  }
  return (await response.json()) as ForwarderResponse;
}

function parseSecretKey(raw: string) {
  const trimmed = raw.trim();
  const asJson = JSON.parse(trimmed) as number[] | string;
  if (Array.isArray(asJson)) {
    return Uint8Array.from(asJson);
  }
  if (typeof asJson === "string") {
    return Uint8Array.from(JSON.parse(asJson));
  }
  throw new Error("Invalid SHADOWWIRE_POOL_SECRET_KEY format.");
}

async function signAndSendBase64Tx(
  connection: Connection,
  unsignedTxBase64: string,
  keypair: Keypair,
) {
  const raw = Buffer.from(unsignedTxBase64, "base64");
  const tx = Transaction.from(raw);
  tx.feePayer = keypair.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.sign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return signature;
}

export async function depositToShadowwirePool(params: {
  walletAddress: string;
  amountUsdc: number;
  tokenMint: string | "Native";
}) {
  const secret = process.env.SHADOWWIRE_POOL_SECRET_KEY;
  if (!secret) {
    throw new Error("SHADOWWIRE_POOL_SECRET_KEY is not configured.");
  }
  const solanaRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL;
  if (!solanaRpc) {
    throw new Error("SOLANA_RPC_URL is not configured.");
  }

  const keypair = Keypair.fromSecretKey(parseSecretKey(secret));
  if (keypair.publicKey.toBase58() !== params.walletAddress) {
    throw new Error("Pool secret key does not match the destination wallet.");
  }

  const client: ShadowWireClient = createShadowWireClient();
  const amountSmallest = TokenUtils.toSmallestUnit(params.amountUsdc, "USDC");
  const tokenMint = params.tokenMint === "Native" ? undefined : params.tokenMint;

  const deposit = await client.deposit({
    wallet: params.walletAddress,
    amount: amountSmallest,
    token_mint: tokenMint,
  });

  if (!deposit.unsigned_tx_base64) {
    throw new Error("ShadowWire deposit failed.");
  }

  const connection = new Connection(solanaRpc, "confirmed");
  const signature = await signAndSendBase64Tx(connection, deposit.unsigned_tx_base64, keypair);
  return signature;
}
