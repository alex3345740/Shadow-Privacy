import { getChainById } from "@silentswap/sdk";
import { getPublicNodeRpcUrl } from "@/lib/evm-rpc";
import type { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string }> },
) {
  const { chainId: chainIdParam } = await params;
  const chainId = Number(chainIdParam);
  if (!Number.isFinite(chainId)) {
    return Response.json({ error: "Invalid chain id" }, { status: 400 });
  }

  const publicNodeUrl = getPublicNodeRpcUrl(chainId);
  const chain = getChainById(chainId);
  const fallbackUrl = chain?.rpcUrls?.default?.http?.[0] ?? chain?.rpcUrls?.public?.http?.[0];
  const rpcUrl = publicNodeUrl ?? fallbackUrl;
  if (!rpcUrl) {
    return Response.json({ error: "Unsupported chain id" }, { status: 404 });
  }

  if (!publicNodeUrl && process.env.NODE_ENV !== "production") {
    console.warn(`[RPC] PublicNode not configured for chain ${chainId}, using fallback RPC.`);
  }

  const body = await request.text();
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
