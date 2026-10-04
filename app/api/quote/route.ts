import { NextResponse } from "next/server";
import { handler, rateLimit, requireSession, HttpError } from "@/lib/server/guard";
import { quoteFor } from "@/lib/server/quoting";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const s = await requireSession();
  await rateLimit(`quote:${s.userId}`, 90, 60);

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "ars" ? "ars" : "brl";
  const amount = (url.searchParams.get("amount") ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw new HttpError(400, "VALOR_INVALIDO", "Digite um valor válido.");
  }
  const max = mode === "brl" ? 1_000_000 : 1_000_000_000;
  if (Number(amount) > max) throw new HttpError(400, "VALOR_ALTO", "Valor muito alto para cotar.");

  const quote = await quoteFor(s.userId, mode, amount);
  return NextResponse.json({ quote });
});
