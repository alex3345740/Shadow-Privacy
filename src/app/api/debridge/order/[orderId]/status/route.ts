import type { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const upstreamUrl = `https://dln.debridge.finance/v1.0/dln/order/${encodeURIComponent(orderId)}/status`;

  const upstream = await fetch(upstreamUrl, { method: "GET" });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

