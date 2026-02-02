import { processPayment } from "@/lib/payments";
import { getPayment } from "@/lib/payment-store";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment) {
    return Response.json({ error: "Payment not found" }, { status: 404 });
  }
  if (payment.status === "created" || payment.status === "awaiting_funds" || payment.status === "awaiting_gas") {
    void processPayment(id);
  }
  return Response.json({ payment });
}
