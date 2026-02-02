"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useAccount, useWalletClient } from "wagmi";
import { SilentSwapProvider, useSolanaAdapter } from "@silentswap/react";
import { createSilentSwapClient, ENVIRONMENT } from "@silentswap/sdk";
import { wagmiConfig } from "@/lib/wagmi";
import { solanaRpcUrl } from "@/lib/solana";
import { ensureSilentSwapRpcOverrides } from "@/lib/evm-rpc";
import { ToastProvider } from "@/components/ui/toast-provider";

ensureSilentSwapRpcOverrides();

function setupWalletStandardGuards() {
  if (typeof window === "undefined") return;

  try {
    const navigatorAny = window.navigator as typeof window.navigator & {
      wallets?: unknown;
    };
    const existing = navigatorAny.wallets;
    if (Array.isArray(existing)) {
      const filtered = existing.filter((callback) => typeof callback === "function");
      if (filtered.length !== existing.length) {
        try {
          existing.length = 0;
          existing.push(...filtered);
        } catch {
          navigatorAny.wallets = filtered;
        }
      }
    }
  } catch {}

  try {
    const windowAny = window as Window & { __walletStandardGuarded?: boolean };
    if (windowAny.__walletStandardGuarded) return;
    windowAny.__walletStandardGuarded = true;
    window.addEventListener(
      "wallet-standard:register-wallet",
      (event) => {
        const detail = (event as CustomEvent).detail;
        if (typeof detail !== "function") {
          event.stopImmediatePropagation();
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[Wallet] Ignored wallet-standard register event with non-function detail",
              detail,
            );
          }
        }
      },
      { capture: true },
    );
  } catch {}
}

setupWalletStandardGuards();

function setupSilentSwapFetchProxies() {
  if (typeof window === "undefined") return;

  const windowAny = window as Window & { __silentSwapFetchProxies?: boolean };
  if (windowAny.__silentSwapFetchProxies) return;
  windowAny.__silentSwapFetchProxies = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url === "https://api.relay.link/quote") {
      return originalFetch("/api/relay/quote", init);
    }

    if (url.startsWith("https://api.relay.link/intents/status")) {
      const parsed = new URL(url);
      return originalFetch(`/api/relay/intents/status?${parsed.searchParams.toString()}`, init);
    }

    if (url.startsWith("https://deswap.debridge.finance/v1.0/dln/order/create-tx")) {
      const parsed = new URL(url);
      return originalFetch(`/api/debridge/create-tx?${parsed.searchParams.toString()}`, init);
    }

    if (url.startsWith("https://dln.debridge.finance/v1.0/dln/order/") && url.endsWith("/status")) {
      const match = url.match(/^https:\/\/dln\.debridge\.finance\/v1\.0\/dln\/order\/([^/]+)\/status$/);
      if (match?.[1]) {
        return originalFetch(`/api/debridge/order/${match[1]}/status`, init);
      }
    }

    return originalFetch(input as never, init);
  };
}

setupSilentSwapFetchProxies();

function SilentSwapLayer({ children }: { children: React.ReactNode }) {
  const { address, connector, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { publicKey } = useWallet();
  const solAddress = publicKey?.toBase58();

  const { solanaConnector, solanaConnectionAdapter } = useSolanaAdapter();

  const environment =
    process.env.NEXT_PUBLIC_SILENTSWAP_ENV === "STAGING"
      ? ENVIRONMENT.STAGING
      : ENVIRONMENT.MAINNET;

  const client = useMemo(
    () =>
      createSilentSwapClient({
        environment,
        baseUrl: process.env.NEXT_PUBLIC_SILENTSWAP_BASE_URL,
      }),
    [environment],
  );

  return (
    <SilentSwapProvider
      client={client}
      environment={environment}
      evmAddress={isConnected ? address : undefined}
      solAddress={solAddress}
      isConnected={isConnected}
      connector={isConnected ? connector : undefined}
      walletClient={isConnected ? walletClient : undefined}
      solanaConnector={solanaConnector}
      solanaConnection={solanaConnectionAdapter}
      solanaRpcUrl={solanaRpcUrl}
    >
      {children}
    </SilentSwapProvider>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [new SolflareWalletAdapter(), new TorusWalletAdapter()],
    [],
  );

  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={solanaRpcUrl}>
          <WalletProvider
            wallets={wallets}
            autoConnect={false}
            onError={(error) => {
              const name = error?.name ?? "";
              if (name.toLowerCase().includes("walletconnectionerror")) return;
              if (process.env.NODE_ENV !== "production") {
                console.warn("[Wallet] Connection error", error);
              }
            }}
          >
            <WalletModalProvider>
              <ToastProvider>
                <SilentSwapLayer>{children}</SilentSwapLayer>
              </ToastProvider>
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
