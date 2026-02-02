import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return Response.json({ error: "Missing requestId" }, { status: 400 });
  }

  const upstreamUrl = new URL("https://api.relay.link/intents/status");
  upstreamUrl.searchParams.set("requestId", requestId);

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

