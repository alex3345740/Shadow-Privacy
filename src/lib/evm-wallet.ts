import crypto from "crypto";
import { getChainById } from "@silentswap/sdk";
import { erc20Abi, http, type Chain, type Hex } from "viem";
import { createPublicClient, createWalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getEvmChainByDomain } from "@/lib/cctp-evm";
import { getPublicNodeRpcUrl } from "@/lib/evm-rpc";
import { PublicKey } from "@solana/web3.js";
import { SOLANA_DOMAIN } from "@/lib/cctp";

const ENCRYPTION_KEY_ENV = "PAYMENT_WALLET_ENCRYPTION_KEY";

function getEncryptionKey() {
  const raw = process.env[ENCRYPTION_KEY_ENV];
  if (!raw) {
    throw new Error(`${ENCRYPTION_KEY_ENV} is not configured.`);
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptPrivateKey(privateKey: Hex) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.slice(2), "hex")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptPrivateKey(encoded: string): Hex {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted private key format.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return `0x${decrypted.toString("hex")}` as Hex;
}

export function createDepositWallet() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKeyEnc: encryptPrivateKey(privateKey),
  };
}

export function solanaAddressToBytes32(address: string): Hex {
  const pubkey = new PublicKey(address);
  return `0x${Buffer.from(pubkey.toBytes()).toString("hex")}` as Hex;
}

export function getRpcUrl(chainId: number) {
  const envKey = `EVM_RPC_${chainId}`;
  const envUrl = process.env[envKey];
  if (envUrl) return envUrl;

  const publicNodeUrl = getPublicNodeRpcUrl(chainId);
  if (publicNodeUrl) return publicNodeUrl;

  const chain = getChainById(chainId);
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0];
  if (!rpcUrl) {
    throw new Error(`No RPC URL available for chain ${chainId}.`);
  }
  return rpcUrl;
}

function getChainConfig(chainId: number): Chain {
  const chain = getChainById(chainId) as unknown as Chain | undefined;
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}.`);
  }
  return chain;
}

export function createClients(chainId: number, privateKey?: Hex) {
  const chain = getChainConfig(chainId);
  const transport = http(getRpcUrl(chainId));
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = privateKey
    ? createWalletClient({
        account: privateKeyToAccount(privateKey),
        chain,
        transport,
      })
    : null;
  return { publicClient, walletClient, chain };
}

export async function getUsdcBalance(params: { domain: number; address: Hex }) {
  const chain = getEvmChainByDomain(params.domain);
  if (!chain) {
    throw new Error("Unsupported CCTP domain.");
  }
  const { publicClient } = createClients(chain.chainId);
  return (await publicClient.readContract({
    address: chain.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [params.address],
  })) as bigint;
}

export async function getNativeBalance(params: { domain: number; address: Hex }) {
  const chain = getEvmChainByDomain(params.domain);
  if (!chain) {
    throw new Error("Unsupported CCTP domain.");
  }
  const { publicClient } = createClients(chain.chainId);
  return await publicClient.getBalance({ address: params.address });
}

export async function burnUsdcWithCctp(params: {
  domain: number;
  privateKeyEnc: string;
  amount: bigint;
  destinationRecipient: Hex;
}) {
  const chain = getEvmChainByDomain(params.domain);
  if (!chain) {
    throw new Error("Unsupported CCTP domain.");
  }
  const privateKey = decryptPrivateKey(params.privateKeyEnc);
  const { publicClient, walletClient, chain: chainConfig } = createClients(chain.chainId, privateKey);
  if (!walletClient) {
    throw new Error("Wallet client unavailable.");
  }

  const destinationCaller = `0x${"0".repeat(64)}` as Hex;
  const maxFee = process.env.CCTP_MAX_FEE ?? "0";
  const minFinalityThreshold = process.env.CCTP_MIN_FINALITY_THRESHOLD ?? "2000";

  const approveHash = await walletClient.writeContract({
    chain: chainConfig,
    address: chain.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [chain.tokenMessengerV2, params.amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const burnHash = await walletClient.writeContract({
    chain: chainConfig,
    address: chain.tokenMessengerV2,
    abi: [
      {
        type: "function",
        name: "depositForBurn",
        stateMutability: "nonpayable",
        inputs: [
          { name: "amount", type: "uint256" },
          { name: "destinationDomain", type: "uint32" },
          { name: "mintRecipient", type: "bytes32" },
          { name: "burnToken", type: "address" },
          { name: "destinationCaller", type: "bytes32" },
          { name: "maxFee", type: "uint256" },
          { name: "minFinalityThreshold", type: "uint32" },
        ],
        outputs: [],
      },
    ],
    functionName: "depositForBurn",
    args: [
      params.amount,
      SOLANA_DOMAIN,
      params.destinationRecipient,
      chain.usdcAddress,
      destinationCaller,
      BigInt(maxFee),
      Number(minFinalityThreshold),
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: burnHash });
  return burnHash;
}
