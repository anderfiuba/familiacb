import { NextResponse } from "next/server";
import { handler, rateLimit, requireSession } from "@/lib/server/guard";
import { bitsoClientFor, mbClientFor } from "@/lib/server/credentials";
import { ExchangeError } from "@/lib/server/exchanges/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const s = await requireSession();
  await rateLimit(`balance:${s.userId}`, 30, 60);

  const [mb, bitso] = await Promise.all([mbClientFor(s.userId), bitsoClientFor(s.userId)]);
  const safe = async <T,>(p: Promise<T>) => {
    try {
      return { ok: true as const, data: await p };
    } catch (e) {
      return { ok: false as const, message: e instanceof ExchangeError ? e.message : "Indisponível no momento." };
    }
  };
  const [mbBal, bitsoBal] = await Promise.all([
    mb ? safe(mb.balances()) : Promise.resolve(null),
    bitso ? safe(bitso.balances()) : Promise.resolve(null),
  ]);
  return NextResponse.json({ mercadobitcoin: mbBal, bitso: bitsoBal });
});
