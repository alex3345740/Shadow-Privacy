import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";

const DEFAULT_SOLANA_RPC = "https://solana.publicnode.com";

export const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC;

export function getSolanaConnection() {
  return new Connection(solanaRpcUrl, "confirmed");
}

export async function getSolBalance(address: string) {
  const connection = getSolanaConnection();
  const lamports = await connection.getBalance(new PublicKey(address), "confirmed");
  return lamports / 1e9;
}

export async function getSplBalance(address: string, mint: string) {
  const connection = getSolanaConnection();
  const owner = new PublicKey(address);
  const mintKey = new PublicKey(mint);
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: mintKey,
  });
  const total = response.value.reduce((acc, item) => {
    const data = item.account.data;
    if ("parsed" in data) {
      const parsed = data as ParsedAccountData;
      const info = parsed.parsed as { info?: { tokenAmount?: { uiAmount?: number } } };
      const amount = info?.info?.tokenAmount?.uiAmount ?? 0;
      return acc + Number(amount);
    }
    return acc;
  }, 0);
  return total;
}
