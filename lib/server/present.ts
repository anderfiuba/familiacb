import "server-only";
import { stationOf, type PublicOperation } from "@/lib/steps";
import { RESUMABLE, type Operation } from "./engine";

/** Remove campos internos (ids de idempotência, locks) antes de mandar ao navegador. */
export function publicOperation(raw: unknown): PublicOperation {
  const op = raw as Operation & { completed_at: string | null };
  const e = op.estimate as Record<string, string>;
  return {
    id: op.id,
    status: op.status,
    failedAt: op.failed_at_status,
    failedStation: op.failed_at_status ? stationOf(op.failed_at_status) : null,
    error: op.error_message,
    canResume: op.status === "failed" && !!op.failed_at_status && !!RESUMABLE[op.failed_at_status],
    createdAt: op.created_at,
    updatedAt: op.updated_at,
    completedAt: op.completed_at,
    brl: String(op.brl_amount),
    estimate: {
      arsNet: e.arsNet ?? "0",
      rate: e.rate ?? "0",
      mbAvgPrice: e.mbAvgPrice ?? "0",
      bitsoAvgPrice: e.bitsoAvgPrice ?? "0",
      usdtArrives: e.usdtArrives ?? "0",
      feesInBrl: e.feesInBrl ?? "0",
    },
    mb: {
      avgPrice: op.mb_avg_price,
      usdtBought: op.usdt_bought,
      feeUsdt: op.mb_trade_fee_usdt,
      withdrawFee: op.mb_withdraw_fee,
      usdtSent: op.usdt_withdrawn,
      tx: op.withdraw_tx,
    },
    bitso: {
      usdtReceived: op.usdt_received,
      usdtSold: op.usdt_sold,
      avgPrice: op.bitso_avg_price,
      feeArs: op.bitso_fee_ars,
      arsReceived: op.ars_received,
    },
  };
}
