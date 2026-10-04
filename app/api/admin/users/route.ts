import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { supabaseAdmin } from "@/lib/server/supabase";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireSession({ admin: true });
  const db = supabaseAdmin();
  const [{ data: profiles }, { data: users }] = await Promise.all([
    db.from("profiles").select("id, full_name, role, limit_per_op, limit_per_day, disabled, created_at").order("created_at"),
    db.auth.admin.listUsers({ perPage: 200 }),
  ]);
  const emailOf = new Map<string, { email: string; confirmed: boolean }>(
    ((users?.users ?? []) as { id: string; email?: string; last_sign_in_at?: string | null }[]).map((u) => [
      u.id,
      { email: u.email ?? "", confirmed: !!u.last_sign_in_at },
    ]),
  );
  return NextResponse.json({
    users: (profiles ?? []).map((p) => {
      const row = p as { id: string };
      return { ...row, email: emailOf.get(row.id)?.email ?? "", active: emailOf.get(row.id)?.confirmed ?? false };
    }),
  });
});

const update = z.object({
  userId: z.string().uuid(),
  limitPerOp: z.number().positive().max(1_000_000),
  limitPerDay: z.number().positive().max(5_000_000),
  disabled: z.boolean(),
  totp: totpCode,
});

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession({ admin: true });
  const b = await parseJson(req, update);
  await requireFreshTotp(s.userId, b.totp);
  if (b.limitPerDay < b.limitPerOp) throw new HttpError(400, "LIMITES", "O limite diário precisa ser maior ou igual ao por operação.");
  if (b.userId === s.userId && b.disabled) throw new HttpError(400, "PROPRIO", "Você não pode desativar a si mesmo.");

  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({ limit_per_op: b.limitPerOp, limit_per_day: b.limitPerDay, disabled: b.disabled } as never)
    .eq("id", b.userId);
  if (error) throw error;
  if (b.disabled) await supabaseAdmin().auth.admin.signOut(b.userId).catch(() => undefined);
  await audit(s.userId, "usuario_atualizado", { target: b.userId, limitPerOp: b.limitPerOp, limitPerDay: b.limitPerDay, disabled: b.disabled });
  return NextResponse.json({ ok: true });
});
