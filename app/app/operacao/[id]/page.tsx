import { notFound } from "next/navigation";
import { pageSession } from "@/lib/server/page-session";
import { supabaseUser } from "@/lib/server/supabase";
import { publicOperation } from "@/lib/server/present";
import { maskDestination } from "@/lib/validation";
import { OperationProgress } from "@/components/progress";

export const dynamic = "force-dynamic";

export default async function OperacaoPage({ params }: { params: Promise<{ id: string }> }) {
  await pageSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const sb = await supabaseUser(); // RLS: só operações do próprio usuário
  const [{ data: op }, { data: events }, { data: accounts }] = await Promise.all([
    sb.from("operations").select("*").eq("id", id).maybeSingle(),
    sb.from("operation_events").select("id, status, kind, message, created_at").eq("operation_id", id).order("id"),
    sb.from("bank_accounts").select("id, label, kind, value").order("created_at"),
  ]);
  if (!op) notFound();

  return (
    <OperationProgress
      initial={{ operation: publicOperation(op), events: events ?? [] }}
      accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.label, masked: maskDestination(a.kind, a.value) }))}
    />
  );
}
