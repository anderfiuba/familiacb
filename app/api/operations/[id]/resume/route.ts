import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { assertSameOrigin, audit, handler, HttpError, parseJson, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin } from "@/lib/server/supabase";
import { RESUMABLE, advance, type Operation } from "@/lib/server/engine";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Retoma uma operação que falhou num ponto seguro (ex.: USDT já está na Bitso, falta vender). */
export const POST = handler(async (req, ctx) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) throw new HttpError(404, "NAO_ENCONTRADA", "Operação não encontrada.");
  const b = await parseJson(req, z.object({ totp: totpCode }));
  await requireFreshTotp(s.userId, b.totp);

  const db = supabaseAdmin();
  const { data: op } = await db.from("operations").select("*").eq("id", id!).eq("user_id", s.userId).maybeSingle<Operation>();
  if (!op || op.status !== "failed" || !op.failed_at_status || !RESUMABLE[op.failed_at_status]) {
    throw new HttpError(409, "NAO_RETOMAVEL", "Esta operação não pode ser retomada automaticamente.");
  }

  let target = RESUMABLE[op.failed_at_status]!;
  const extra: Record<string, unknown> = {};
  if (op.failed_at_status === "bitso_sell_submitted") {
    // Venda anterior foi cancelada sem execução: nova tentativa com novo origin_id.
    target = "bitso_sell_submitting";
    extra.bitso_origin_id = `fcb-${randomUUID().replace(/-/g, "")}`;
    extra.bitso_order_id = null;
  }

  const { error } = await db
    .from("operations")
    .update({
      status: target,
      failed_at_status: null,
      error_message: null,
      next_check_at: null,
      updated_at: new Date().toISOString(),
      ...extra,
    } as never)
    .eq("id", op.id)
    .eq("status", "failed");
  if (error?.code === "23505") throw new HttpError(409, "OPERACAO_EM_ANDAMENTO", "Já existe outra conversão em andamento.");
  if (error) throw error;

  await db.from("operation_events").insert({
    operation_id: op.id,
    user_id: s.userId,
    status: target,
    kind: "info",
    message: "Operação retomada.",
  } as never);
  await audit(s.userId, "operacao_retomada", { operation_id: op.id, from: op.failed_at_status });
  await advance(op.id, s.userId).catch(() => undefined);
  return NextResponse.json({ ok: true });
});
