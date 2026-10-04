import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin } from "@/lib/server/supabase";
import { env } from "@/lib/server/env";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession({ admin: true });
  await rateLimit(`invite:${s.userId}`, 10, 3600);
  const b = await parseJson(
    req,
    z.object({
      email: z.string().trim().toLowerCase().email("E-mail inválido."),
      fullName: z.string().trim().min(2).max(80),
      totp: totpCode,
    }),
  );
  await requireFreshTotp(s.userId, b.totp);

  const { error } = await supabaseAdmin().auth.admin.inviteUserByEmail(b.email, {
    data: { full_name: b.fullName },
    redirectTo: `${env().APP_URL}/auth/confirmar`,
  });
  if (error) throw new HttpError(400, "CONVITE_FALHOU", "Não foi possível enviar o convite (o e-mail já pode estar cadastrado).");
  await audit(s.userId, "convite_enviado", { email: b.email });
  return NextResponse.json({ ok: true });
});
