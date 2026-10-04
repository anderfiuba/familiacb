import { NextResponse } from "next/server";
import { handler, HttpError, requireSession } from "@/lib/server/guard";
import { supabaseUser } from "@/lib/server/supabase";
import { publicOperation } from "@/lib/server/present";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req, ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) throw new HttpError(404, "NAO_ENCONTRADA", "Operação não encontrada.");

  // Cliente com sessão do usuário: a RLS garante que só o dono enxerga.
  const sb = await supabaseUser();
  const [{ data: op }, { data: events }] = await Promise.all([
    sb.from("operations").select("*").eq("id", id).maybeSingle(),
    sb.from("operation_events").select("id, status, kind, message, created_at").eq("operation_id", id).order("id"),
  ]);
  if (!op) throw new HttpError(404, "NAO_ENCONTRADA", "Operação não encontrada.");
  return NextResponse.json({ operation: publicOperation(op), events: events ?? [] });
});
