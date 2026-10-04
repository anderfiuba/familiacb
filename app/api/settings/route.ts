import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, parseJson, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { mbClientFor, updateSettings } from "@/lib/server/credentials";
import { polygonAddress, totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

const body = z.object({
  bitso_usdt_address: polygonAddress,
  travel_rule_name: z.string().trim().min(5, "Informe o nome completo do titular.").max(120),
  totp: totpCode,
});

/** Alterar o destino do USDT é sensível: exige 2FA e é checado contra a lista de confiáveis do MB. */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  const b = await parseJson(req, body);
  await requireFreshTotp(s.userId, b.totp);

  let whitelisted: boolean | null = null;
  const mb = await mbClientFor(s.userId);
  if (mb) {
    try {
      const list = await mb.withdrawAddresses();
      whitelisted = list.some((a) => a.toLowerCase() === b.bitso_usdt_address.toLowerCase());
    } catch {
      whitelisted = null; // sem IP fixo configurado o MB não responde esta consulta
    }
  }

  await updateSettings(s.userId, { bitso_usdt_address: b.bitso_usdt_address, travel_rule_name: b.travel_rule_name });
  await audit(s.userId, "destino_usdt_alterado", { address: b.bitso_usdt_address, whitelisted });
  return NextResponse.json({ ok: true, whitelisted });
});
