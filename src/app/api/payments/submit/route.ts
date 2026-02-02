import { getPayment, updatePayment } from "@/lib/payment-store";
import { processPayment } from "@/lib/payments";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    id?: string;
    sourceTxHash?: string;
  };

  const id = body.id?.trim();
  const sourceTxHash = body.sourceTxHash?.trim();

  if (!id || !sourceTxHash) {
    return Response.json({ error: "Missing id or sourceTxHash" }, { status: 400 });
  }

  const payment = await getPayment(id);
  if (!payment) {
    return Response.json({ error: "Payment not found" }, { status: 404 });
  }

  const updated = await updatePayment(id, {
    status: "submitted",
    sourceTxHash,
  });

  void processPayment(id);

  return Response.json({ payment: updated });
}

export async function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
