import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit } from "@/lib/server/guard";
import { supabaseUser } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const password = z
  .string()
  .min(12, "Use pelo menos 12 caracteres.")
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Misture letras e números.");

/** Definir senha após aceitar o convite (sessão criada pelo link do e-mail). */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, "NAO_AUTENTICADO", "O link expirou. Peça um novo convite.");
  await rateLimit(`pwd:${data.user.id}`, 5, 900);

  const b = await parseJson(req, z.object({ password }));
  const { error } = await sb.auth.updateUser({ password: b.password });
  if (error) throw new HttpError(400, "SENHA_RECUSADA", "Não foi possível salvar a senha. Escolha outra.");
  await audit(data.user.id, "senha_definida");
  return NextResponse.json({ next: "/verificar" });
});
