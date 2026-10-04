import "server-only";
import { quoteFromArs, quoteFromBrl, type Breakdown } from "@/lib/quote";
import { DEFAULT_BITSO_TAKER, DEFAULT_MB_TAKER, marketSnapshot } from "./market";
import { bitsoClientFor, mbClientFor } from "./credentials";

type Fees = { mb: string; bitso: string; personal: boolean; at: number };
const feeCache = new Map<string, Fees>();

/** Taxas reais da conta (quando há chaves), com cache de 5 min; senão, as taxas padrão. */
export async function feesFor(userId: string): Promise<Fees> {
  const c = feeCache.get(userId);
  if (c && Date.now() - c.at < 300_000) return c;
  const [mb, bitso] = await Promise.all([mbClientFor(userId), bitsoClientFor(userId)]);
  const [mbFee, bitsoFee] = await Promise.all([
    mb ? mb.takerFee().catch(() => null) : null,
    bitso ? bitso.takerFee().catch(() => null) : null,
  ]);
  const fees = {
    mb: mbFee ?? DEFAULT_MB_TAKER,
    bitso: bitsoFee ?? DEFAULT_BITSO_TAKER,
    personal: Boolean(mbFee && bitsoFee),
    at: Date.now(),
  };
  feeCache.set(userId, fees);
  return fees;
}

export function forgetFees(userId: string) {
  feeCache.delete(userId);
}

export type QuoteResult = Breakdown & {
  mode: "brl" | "ars";
  mbTakerFee: string;
  bitsoTakerFee: string;
  personalFees: boolean;
  quotedAt: string;
};

export async function quoteFor(userId: string, mode: "brl" | "ars", amount: string): Promise<QuoteResult> {
  const [snap, fees] = await Promise.all([marketSnapshot(), feesFor(userId)]);
  const input = { ...snap, mbTakerFee: fees.mb, bitsoTakerFee: fees.bitso };
  const b = mode === "brl" ? quoteFromBrl(amount, input) : quoteFromArs(amount, input);
  return {
    ...b,
    mode,
    mbTakerFee: fees.mb,
    bitsoTakerFee: fees.bitso,
    personalFees: fees.personal,
    quotedAt: new Date().toISOString(),
  };
}
