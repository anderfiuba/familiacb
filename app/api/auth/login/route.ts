import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, clientIp, handler, HttpError, parseJson, rateLimit } from "@/lib/server/guard";
import { supabaseUser } from "@/lib/server/supabase";
import { sha256 } from "@/lib/server/crypto";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const b = await parseJson(
    req,
    z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido."), password: z.string().min(1).max(200) }),
  );
  const ip = await clientIp();
  await rateLimit(`login-ip:${ip}`, 20, 900);
  await rateLimit(`login-email:${sha256(b.email)}`, 6, 900);

  const sb = await supabaseUser();
  const { data, error } = await sb.auth.signInWithPassword({ email: b.email, password: b.password });
  if (error || !data.user) {
    await audit(null, "login_falhou", { email_hash: sha256(b.email).slice(0, 16) });
    // Mensagem genérica: não revela se o e-mail existe.
    throw new HttpError(401, "LOGIN_INVALIDO", "E-mail ou senha incorretos.");
  }
  await audit(data.user.id, "login_senha_ok");
  return NextResponse.json({ next: "/verificar" });
});
