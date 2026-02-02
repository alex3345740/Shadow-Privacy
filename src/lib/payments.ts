import { TokenUtils } from "@radr/shadowwire";
import { parseUnits } from "viem";
import { depositToShadowwirePool, forwardToSolana, waitForAttestation } from "@/lib/cctp";
import { burnUsdcWithCctp, getNativeBalance, getUsdcBalance, solanaAddressToBytes32 } from "@/lib/evm-wallet";
import { getPayment, updatePayment } from "@/lib/payment-store";

export async function processPayment(paymentId: string) {
  const payment = await getPayment(paymentId);
  if (!payment) {
    return null;
  }

  if (payment.status === "completed" || payment.status === "failed") {
    return payment;
  }

  if (!payment.sourceTxHash) {
    if (!payment.sourceWalletPrivateKeyEnc || !payment.sourceWalletAddress) {
      return payment;
    }

    if (payment.status === "burning") {
      return payment;
    }

    const requiredAmount = parseUnits(String(payment.amountUsdc), 6);
    const usdcBalance = await getUsdcBalance({
      domain: payment.sourceDomain,
      address: payment.sourceWalletAddress as `0x${string}`,
    });
    if (usdcBalance < requiredAmount) {
      if (payment.status !== "awaiting_funds") {
        await updatePayment(paymentId, { status: "awaiting_funds" });
      }
      return await getPayment(paymentId);
    }

    const nativeBalance = await getNativeBalance({
      domain: payment.sourceDomain,
      address: payment.sourceWalletAddress as `0x${string}`,
    });
    if (nativeBalance === BigInt(0)) {
      if (payment.status !== "awaiting_gas") {
        await updatePayment(paymentId, { status: "awaiting_gas" });
      }
      return await getPayment(paymentId);
    }

    await updatePayment(paymentId, { status: "burning" });
    const burnTxHash = await burnUsdcWithCctp({
      domain: payment.sourceDomain,
      privateKeyEnc: payment.sourceWalletPrivateKeyEnc,
      amount: requiredAmount,
      destinationRecipient: solanaAddressToBytes32(payment.destinationWallet),
    });

    await updatePayment(paymentId, { status: "submitted", sourceTxHash: burnTxHash });
    const refreshed = await getPayment(paymentId);
    if (!refreshed?.sourceTxHash) {
      return refreshed ?? null;
    }
    return await processPayment(paymentId);
  }

  try {
    if (payment.depositTx) {
      return payment;
    }

    if (!payment.forwardTx) {
      await updatePayment(paymentId, { status: "attestation_pending" });
      const message = await waitForAttestation(payment.sourceDomain, payment.sourceTxHash);

      if (message.attestation) {
        await updatePayment(paymentId, {
          status: "attested",
          attestation: message.attestation,
        });
      }

      await updatePayment(paymentId, { status: "forwarding" });
      const forward = await forwardToSolana(message, payment.destinationWallet);

      await updatePayment(paymentId, {
        status: "depositing",
        forwardTx: forward.signature ?? forward.transaction,
      });
    }

    const tokenMint = TokenUtils.getTokenMint("USDC");
    const amount = payment.amountUsdc;

    const depositTx = await depositToShadowwirePool({
      walletAddress: payment.destinationWallet,
      amountUsdc: amount,
      tokenMint,
    });

    await updatePayment(paymentId, {
      status: "completed",
      depositTx,
    });
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    await updatePayment(paymentId, {
      status: "failed",
      error: err,
    });
  }

  return await getPayment(paymentId);
}
