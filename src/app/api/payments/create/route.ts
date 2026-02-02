import { CCTP_USDC_CHAINS, getCctpChain } from "@/lib/cctp";
import { getEvmChainByDomain } from "@/lib/cctp-evm";
import { createDepositWallet } from "@/lib/evm-wallet";
import { createPayment } from "@/lib/payment-store";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    amountUsdc?: number;
    sourceDomain?: number;
    destinationWallet?: string;
    label?: string;
    reference?: string;
    note?: string;
    autoDepositApproved?: boolean;
  };

  const amountUsdc = Number(body.amountUsdc);
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return Response.json({ error: "Invalid amount" }, { status: 400 });
  }

  const sourceDomain = Number(body.sourceDomain);
  const chain = getCctpChain(sourceDomain);
  if (!chain || !chain.usdcSupported) {
    return Response.json(
      { error: "Unsupported CCTP domain for USDC", available: CCTP_USDC_CHAINS },
      { status: 400 },
    );
  }

  const destinationWallet = body.destinationWallet?.trim();
  if (!destinationWallet) {
    return Response.json({ error: "Destination wallet required" }, { status: 400 });
  }

  if (!body.autoDepositApproved) {
    return Response.json(
      { error: "Approval required to auto-deposit into ShadowWire pool." },
      { status: 400 },
    );
  }

  const evmChain = getEvmChainByDomain(sourceDomain);
  if (!evmChain) {
    return Response.json(
      { error: "Selected chain does not support EVM deposit wallets yet." },
      { status: 400 },
    );
  }

  let wallet: { address: string; privateKeyEnc: string };
  try {
    wallet = createDepositWallet();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        error: message,
        requiredEnv: ["PAYMENT_WALLET_ENCRYPTION_KEY"],
      },
      { status: 500 },
    );
  }

  const payment = await createPayment({
    amountUsdc,
    sourceDomain,
    sourceChain: chain.name,
    sourceWalletAddress: wallet.address,
    sourceWalletPrivateKeyEnc: wallet.privateKeyEnc,
    destinationWallet,
    label: body.label?.trim() || undefined,
    reference: body.reference?.trim() || undefined,
    note: body.note?.trim() || undefined,
    autoDepositApproved: true,
  });

  const origin =
    request.headers.get("origin") ??
    `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}`;
  const link = `${origin}/pay/${payment.id}`;

  return Response.json({ payment, link });
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
