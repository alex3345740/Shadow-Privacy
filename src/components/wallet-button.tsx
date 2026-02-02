"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <Button variant="secondary" disabled>
        Select Wallet
      </Button>
    ),
  },
);

export function WalletButton() {
  return <WalletMultiButton />;
}
