import { A_VIEM_CHAINS } from "@silentswap/sdk";

const DEFAULT_PROXY_PREFIX = "/api/evm-rpc";

let patched = false;

const PUBLICNODE_RPC_BY_CHAIN: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  43114: "https://avalanche-c-chain-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  2222: "https://kava-evm-rpc.publicnode.com",
};

export function getPublicNodeRpcUrl(chainId: number) {
  return PUBLICNODE_RPC_BY_CHAIN[chainId] ?? null;
}

export function getEvmRpcUrl(chainId: number) {
  const base = process.env.NEXT_PUBLIC_EVM_RPC_PROXY_BASE ?? DEFAULT_PROXY_PREFIX;
  return `${base}/${chainId}`;
}

export function ensureSilentSwapRpcOverrides() {
  if (patched) return;
  patched = true;

  try {
    A_VIEM_CHAINS.forEach((chain) => {
      const proxyUrl = getEvmRpcUrl(chain.id);
      const rpcUrls = chain.rpcUrls as unknown as
        | { default?: { http?: string[] }; public?: { http?: string[] } }
        | undefined;
      const defaultHttp = rpcUrls?.default?.http ?? [];
      const publicHttp = rpcUrls?.public?.http ?? [];

      (chain as { rpcUrls?: unknown }).rpcUrls = {
        ...rpcUrls,
        default: { ...rpcUrls?.default, http: [proxyUrl, ...defaultHttp] },
        public: { ...rpcUrls?.public, http: [proxyUrl, ...publicHttp] },
      };
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[RPC] Failed to patch SilentSwap RPC urls", error);
    }
  }
}
