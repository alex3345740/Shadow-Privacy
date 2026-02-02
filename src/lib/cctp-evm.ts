export type CctpEvmChain = {
  chainId: number;
  domain: number;
  name: string;
  usdcAddress: `0x${string}`;
  tokenMessengerV2: `0x${string}`;
};

export const TOKEN_MESSENGER_V2_ADDRESS =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const;

const DEFAULT_CCTP_EVM_CHAINS: CctpEvmChain[] = [
  {
    chainId: 1,
    domain: 0,
    name: "Ethereum",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
  {
    chainId: 43114,
    domain: 1,
    name: "Avalanche",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
  {
    chainId: 10,
    domain: 2,
    name: "OP Mainnet",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
  {
    chainId: 42161,
    domain: 3,
    name: "Arbitrum",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
  {
    chainId: 8453,
    domain: 6,
    name: "Base",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
  {
    chainId: 137,
    domain: 7,
    name: "Polygon PoS",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    tokenMessengerV2: TOKEN_MESSENGER_V2_ADDRESS,
  },
];

function parseCustomChains(): CctpEvmChain[] {
  const raw =
    process.env.CCTP_EVM_CHAINS_JSON ??
    process.env.NEXT_PUBLIC_CCTP_EVM_CHAINS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<CctpEvmChain>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((chain) => {
        if (!chain.chainId || !chain.domain || !chain.usdcAddress || !chain.name) return null;
        return {
          chainId: Number(chain.chainId),
          domain: Number(chain.domain),
          name: String(chain.name),
          usdcAddress: chain.usdcAddress as `0x${string}`,
          tokenMessengerV2:
            (chain.tokenMessengerV2 as `0x${string}`) ?? TOKEN_MESSENGER_V2_ADDRESS,
        } satisfies CctpEvmChain;
      })
      .filter(Boolean) as CctpEvmChain[];
  } catch {
    return [];
  }
}

const CUSTOM_CCTP_EVM_CHAINS = parseCustomChains();

export const CCTP_EVM_CHAINS: CctpEvmChain[] = [
  ...DEFAULT_CCTP_EVM_CHAINS,
  ...CUSTOM_CCTP_EVM_CHAINS,
].reduce<CctpEvmChain[]>((acc, chain) => {
  if (acc.some((existing) => existing.domain === chain.domain)) return acc;
  acc.push(chain);
  return acc;
}, []);

export function getEvmChainByDomain(domain: number) {
  return CCTP_EVM_CHAINS.find((chain) => chain.domain === domain) ?? null;
}

export function getEvmChainById(chainId: number) {
  return CCTP_EVM_CHAINS.find((chain) => chain.chainId === chainId) ?? null;
}
