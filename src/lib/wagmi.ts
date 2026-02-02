import { createConfig, http } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { arbitrum, avalanche, base, mainnet, optimism, polygon } from "wagmi/chains";
import { getEvmRpcUrl } from "@/lib/evm-rpc";

export const wagmiChains = [mainnet, base, arbitrum, optimism, polygon, avalanche] as const;

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  "1217a78dc809d6a93ace25623c0f5c37";

if (process.env.NODE_ENV !== "production" && !projectId) {
  console.warn("Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID for WalletConnect.");
}

export const wagmiConfig = createConfig({
  chains: wagmiChains,
  connectors: [
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: "Shadow Privacy",
        description: "ShadowWire private transfers and SilentSwap multi-chain swaps",
        url: "http://localhost:3000",
        icons: ["https://walletconnect.com/walletconnect-logo.png"],
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(getEvmRpcUrl(mainnet.id)),
    [base.id]: http(getEvmRpcUrl(base.id)),
    [arbitrum.id]: http(getEvmRpcUrl(arbitrum.id)),
    [optimism.id]: http(getEvmRpcUrl(optimism.id)),
    [polygon.id]: http(getEvmRpcUrl(polygon.id)),
    [avalanche.id]: http(getEvmRpcUrl(avalanche.id)),
  },
});
