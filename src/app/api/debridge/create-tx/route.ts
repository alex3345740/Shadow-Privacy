import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const upstreamUrl = new URL("https://deswap.debridge.finance/v1.0/dln/order/create-tx");
  request.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

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

