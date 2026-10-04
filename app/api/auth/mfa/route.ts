import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit } from "@/lib/server/guard";
import { supabaseUser } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

async function currentUser() {
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, "NAO_AUTENTICADO", "Entre novamente.");
  return { sb, user: data.user };
}

/** Estado do 2FA: já configurado (só verificar) ou precisa cadastrar. */
export const GET = handler(async () => {
  const { sb } = await currentUser();
  const { data } = await sb.auth.mfa.listFactors();
  return NextResponse.json({ configured: Boolean(data?.totp?.some((f) => f.status === "verified")) });
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/, "Digite os 6 números.") }),
]);

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const { sb, user } = await currentUser();
  const b = await parseJson(req, body);
  const { data: list } = await sb.auth.mfa.listFactors();
  const verified = list?.all?.find((f) => f.factor_type === "totp" && f.status === "verified");

  if (b.action === "enroll") {
    if (verified) throw new HttpError(409, "JA_CONFIGURADO", "O autenticador já está configurado.");
    await rateLimit(`mfa-enroll:${user.id}`, 5, 900);
    // Remove tentativas anteriores não concluídas.
    for (const f of list?.all ?? []) {
      if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "familiacb", issuer: "familiacb" });
    if (error || !data) throw new HttpError(500, "MFA_FALHOU", "Não foi possível gerar o QR code.");
    return NextResponse.json({ qr: data.totp.qr_code, secret: data.totp.secret });
  }

  await rateLimit(`mfa-verify:${user.id}`, 8, 300);
  const factor = verified ?? list?.all?.find((f) => f.factor_type === "totp");
  if (!factor) throw new HttpError(400, "MFA_NAO_CONFIGURADO", "Configure o autenticador primeiro.");
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: b.code });
  if (error) {
    await audit(user.id, "mfa_falhou");
    throw new HttpError(401, "CODIGO_INCORRETO", "Código incorreto ou expirado.");
  }
  await audit(user.id, verified ? "mfa_ok" : "mfa_configurado");
  return NextResponse.json({ next: "/app" });
});
