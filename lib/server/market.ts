import "server-only";
import type { QuoteInput } from "@/lib/quote";
import { MercadoBitcoin } from "./exchanges/mercadobitcoin";
import { Bitso } from "./exchanges/bitso";

/** Taxas padrão usadas quando o usuário ainda não tem chaves (estimativa pública). */
export const DEFAULT_MB_TAKER = "0.007"; // 0,70% — tier inicial do Mercado Bitcoin (confirmado via API quando há chave)
export const DEFAULT_BITSO_TAKER = "0.006"; // 0,60% — tier inicial do livro usdt_ars

type MarketSnapshot = Omit<QuoteInput, "mbTakerFee" | "bitsoTakerFee"> & { fetchedAt: number };

let snapshot: MarketSnapshot | null = null;
let inflight: Promise<MarketSnapshot> | null = null;

/** Livros e taxa de rede, com cache curto (5 s) por instância para não estourar rate limits. */
export async function marketSnapshot(maxAgeMs = 5_000): Promise<MarketSnapshot> {
  if (snapshot && Date.now() - snapshot.fetchedAt < maxAgeMs) return snapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    const [mbBook, bitsoBook, wFee] = await Promise.all([
      MercadoBitcoin.orderbook("USDT-BRL", 200),
      Bitso.orderbook("usdt_ars"),
      MercadoBitcoin.withdrawFee("USDT", "polygon"),
    ]);
    snapshot = {
      mbAsks: mbBook.asks,
      bitsoBids: bitsoBook.bids,
      withdrawFeeUsdt: wFee.fee,
      withdrawMinUsdt: wFee.minimum,
      fetchedAt: Date.now(),
    };
    return snapshot;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
