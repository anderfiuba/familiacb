import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin, supabaseUser } from "@/lib/server/supabase";
import { classifyDestination, maskDestination, totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireSession();
  const sb = await supabaseUser();
  const { data } = await sb.from("bank_accounts").select("id, label, kind, value, created_at").order("created_at");
  return NextResponse.json({
    accounts: (data ?? []).map((a) => ({ id: a.id, label: a.label, kind: a.kind, masked: maskDestination(a.kind, a.value) })),
  });
});

const add = z.object({
  action: z.literal("add"),
  label: z.string().trim().min(1).max(40),
  destination: z.string().trim().min(6).max(30),
  totp: totpCode,
});
const remove = z.object({ action: z.literal("remove"), id: z.string().uuid(), totp: totpCode });

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  const b = await parseJson(req, z.discriminatedUnion("action", [add, remove]));
  await requireFreshTotp(s.userId, b.totp);
  const db = supabaseAdmin();

  if (b.action === "add") {
    const dest = classifyDestination(b.destination);
    if (!dest) throw new HttpError(400, "DESTINO_INVALIDO", "CBU/CVU (22 números) ou alias inválido.");
    const { count } = await db.from("bank_accounts").select("id", { count: "exact", head: true }).eq("user_id", s.userId);
    if ((count ?? 0) >= 20) throw new HttpError(400, "LIMITE_CONTAS", "Limite de 20 contas salvas.");
    const { error } = await db
      .from("bank_accounts")
      .insert({ user_id: s.userId, label: b.label, kind: dest.kind, value: dest.value } as never);
    if (error?.code === "23505") throw new HttpError(409, "DUPLICADA", "Esta conta já está salva.");
    if (error) throw error;
    await audit(s.userId, "conta_ars_adicionada", { kind: dest.kind, masked: maskDestination(dest.kind, dest.value) });
  } else {
    await db.from("bank_accounts").delete().eq("id", b.id).eq("user_id", s.userId);
    await audit(s.userId, "conta_ars_removida", { id: b.id });
  }
  return NextResponse.json({ ok: true });
});
