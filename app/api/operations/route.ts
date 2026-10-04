import { NextResponse } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin } from "@/lib/server/supabase";
import { clientsFor } from "@/lib/server/credentials";
import { quoteFor } from "@/lib/server/quoting";
import { advance } from "@/lib/server/engine";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({
  mode: z.enum(["brl", "ars"]),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido."),
  // taxa (ARS por BRL) que o usuário viu na tela de confirmação
  shownRate: z.string().regex(/^\d+(\.\d+)?$/),
  totp: totpCode,
});

const LIMIT_MESSAGES: Record<string, string> = {
  LIMITE_POR_OPERACAO: "Valor acima do seu limite por operação.",
  LIMITE_DIARIO: "Este valor ultrapassa o seu limite diário.",
  USUARIO_BLOQUEADO: "Acesso desativado.",
};

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  await rateLimit(`op:${s.userId}`, 5, 600);
  const b = await parseJson(req, body);
  await requireFreshTotp(s.userId, b.totp);

  const { settings } = await clientsFor(s.userId); // garante que as duas chaves existem
  if (!settings.bitso_usdt_address || !settings.travel_rule_name) {
    throw new HttpError(409, "DESTINO_PENDENTE", "Configure o endereço USDT da Bitso e o nome do titular.");
  }

  // Recalcula a cotação no servidor: o cliente nunca define valores da operação.
  const quote = await quoteFor(s.userId, b.mode, b.amount);
  if (quote.warnings.length) throw new HttpError(400, "COTACAO_INVALIDA", quote.warnings[0]!);
  const brl = new Decimal(quote.brl);
  if (brl.lt(50)) throw new HttpError(400, "VALOR_BAIXO", "O valor mínimo por operação é R$ 50,00.");
  if (brl.gt(s.profile.limit_per_op)) throw new HttpError(400, "LIMITE_POR_OPERACAO", LIMIT_MESSAGES.LIMITE_POR_OPERACAO!);

  // Se o mercado piorou muito desde a tela de confirmação, pede para revisar.
  const shown = new Decimal(b.shownRate);
  if (shown.gt(0) && new Decimal(quote.rate).lt(shown.mul("0.985"))) {
    throw new HttpError(409, "COTACAO_MUDOU", "A cotação mudou mais de 1,5% desde a sua confirmação. Revise e confirme de novo.");
  }

  const { data, error } = await supabaseAdmin().rpc("create_operation" as never, {
    p_user_id: s.userId,
    p_input_mode: b.mode,
    p_brl: quote.brl,
    p_estimate: quote,
  } as never);
  if (error) {
    const key = Object.keys(LIMIT_MESSAGES).find((k) => error.message.includes(k));
    if (key) throw new HttpError(400, key, LIMIT_MESSAGES[key]!);
    if (error.code === "23505") throw new HttpError(409, "OPERACAO_EM_ANDAMENTO", "Já existe uma conversão em andamento.");
    throw error;
  }
  const op = data as { id: string };
  await audit(s.userId, "operacao_criada", { operation_id: op.id, brl: quote.brl });

  await advance(op.id, s.userId).catch(() => undefined); // primeiro passo já sai daqui
  return NextResponse.json({ id: op.id });
});
