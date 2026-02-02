import { ShadowWireClient } from "@radr/shadowwire";

export function createShadowWireClient() {
  return new ShadowWireClient({
    apiBaseUrl: "https://shadow.radr.fun/shadowpay/api",
    apiKey: process.env.SHADOWWIRE_API_KEY ?? process.env.NEXT_PUBLIC_SHADOWWIRE_API_KEY,
    debug: process.env.NEXT_PUBLIC_SHADOWWIRE_DEBUG === "1",
  });
}
