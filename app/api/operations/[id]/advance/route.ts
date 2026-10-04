import { NextResponse } from "next/server";
import { assertSameOrigin, handler, HttpError, rateLimit, requireSession } from "@/lib/server/guard";
import { advance } from "@/lib/server/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Chamado pela tela de progresso a cada poucos segundos; executa no máximo um passo. */
export const POST = handler(async (req, ctx) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) throw new HttpError(404, "NAO_ENCONTRADA", "Operação não encontrada.");
  await rateLimit(`adv:${s.userId}`, 60, 60);
  await advance(id!, s.userId); // filtra por user_id internamente
  return NextResponse.json({ ok: true });
});
