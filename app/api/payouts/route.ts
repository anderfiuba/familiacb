import { NextResponse } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin } from "@/lib/server/supabase";
import { bitsoClientFor } from "@/lib/server/credentials";
import { ExchangeError } from "@/lib/server/exchanges/http";
import { classifyDestination, maskDestination, totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido."),
  bankAccountId: z.string().uuid().optional(),
  destination: z.string().trim().max(30).optional(),
  saveAs: z.string().trim().min(1).max(40).optional(),
  operationId: z.string().uuid().optional(),
  totp: totpCode,
});

/** Campo que a Bitso espera para cada tipo de destino, conforme os métodos habilitados na conta. */
function fieldFor(kind: "cbu" | "cvu" | "alias", required: string[]): string {
  const want = kind === "alias" ? ["alias", "cbu_alias"] : [kind, "cbu", "cvu", "account_number"];
  return required.find((f) => want.includes(f)) ?? (kind === "alias" ? "alias" : "cbu");
}

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  await rateLimit(`payout:${s.userId}`, 5, 600);
  const b = await parseJson(req, body);
  await requireFreshTotp(s.userId, b.totp);

  const db = supabaseAdmin();

  // Destino: conta salva do próprio usuário, ou digitado agora.
  let dest: { kind: "cbu" | "cvu" | "alias"; value: string } | null = null;
  if (b.bankAccountId) {
    const { data } = await db
      .from("bank_accounts")
      .select("kind, value")
      .eq("id", b.bankAccountId)
      .eq("user_id", s.userId)
      .maybeSingle();
    dest = data as typeof dest;
  } else if (b.destination) {
    dest = classifyDestination(b.destination);
  }
  if (!dest) throw new HttpError(400, "DESTINO_INVALIDO", "Escolha uma conta salva ou digite um CBU/CVU/alias válido.");

  const bitso = await bitsoClientFor(s.userId);
  if (!bitso) throw new HttpError(409, "CHAVES_PENDENTES", "Configure a chave da Bitso.");

  const amount = new Decimal(b.amount);
  const bal = await bitso.balances();
  if (amount.gt(bal.ars)) {
    throw new HttpError(400, "SALDO_INSUFICIENTE", `Saldo em pesos insuficiente (disponível $ ${new Decimal(bal.ars).toFixed(2)}).`);
  }

  const methods = await bitso.arsWithdrawalMethods();
  const method = methods.find((m) => /cbu|cvu|bank|transfer|coelsa|bind/i.test(`${m.method} ${m.name ?? ""}`)) ?? methods[0];
  if (!method) throw new HttpError(409, "SEM_METODO", "Sua conta Bitso não tem método de saque em pesos habilitado.");
  const field = fieldFor(dest.kind, method.required_fields ?? []);

  const originId = `fcbp-${randomUUID().replace(/-/g, "").slice(0, 32)}`;
  const masked = maskDestination(dest.kind, dest.value);
  const { data: payout, error } = await db
    .from("payouts")
    .insert({
      user_id: s.userId,
      operation_id: b.operationId ?? null,
      amount_ars: amount.toFixed(2),
      destination_kind: dest.kind,
      destination_masked: masked,
      origin_id: originId,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !payout) throw new HttpError(500, "ERRO_SALVAR", "Não foi possível registrar o saque.");

  try {
    const w = await bitso.withdrawArs({
      method: method.method,
      amount: amount.toFixed(2),
      originId,
      fields: { [field]: dest.value },
    });
    await db.from("payouts").update({ bitso_wid: w.wid, status: w.status ?? "pending" } as never).eq("id", payout.id);
  } catch (e) {
    const message = e instanceof ExchangeError ? e.message : "Falha ao solicitar o saque.";
    await db.from("payouts").update({ status: "failed", error_message: message } as never).eq("id", payout.id);
    await audit(s.userId, "saque_ars_recusado", { payout_id: payout.id });
    throw new HttpError(400, "SAQUE_RECUSADO", `A Bitso recusou o saque: ${message}`);
  }

  if (b.saveAs && !b.bankAccountId) {
    await db
      .from("bank_accounts")
      .insert({ user_id: s.userId, label: b.saveAs, kind: dest.kind, value: dest.value } as never);
  }
  await audit(s.userId, "saque_ars_solicitado", { payout_id: payout.id, amount: amount.toFixed(2), masked });
  return NextResponse.json({ ok: true, destination: masked });
});
