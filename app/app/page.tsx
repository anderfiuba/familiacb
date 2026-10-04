import { pageSession } from "@/lib/server/page-session";
import { credentialStatus, getSettings } from "@/lib/server/credentials";
import { supabaseUser } from "@/lib/server/supabase";
import { Converter } from "@/components/converter";

export const dynamic = "force-dynamic";

/** Início do dia de hoje em São Paulo (UTC−3, sem horário de verão desde 2019), em ISO UTC. */
function startOfTodaySaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 3, 0, 0)).toISOString();
}

export default async function ConverterPage() {
  const s = await pageSession();
  const sb = await supabaseUser();

  const [creds, settings, { data: active }, { data: today }] = await Promise.all([
    credentialStatus(s.userId),
    getSettings(s.userId),
    sb.from("operations").select("id, status, brl_amount").not("status", "in", "(completed,failed)").maybeSingle(),
    sb.from("operations").select("brl_amount, status, mb_order_id").gte("created_at", startOfTodaySaoPaulo()),
  ]);

  // Mesma regra do banco: falhas antes da compra não contam no limite.
  const used = (today ?? [])
    .filter((o) => !(o.status === "failed" && !o.mb_order_id))
    .reduce((sum, o) => sum + Number(o.brl_amount), 0);

  const missing: string[] = [];
  if (!creds.mercadobitcoin.configured) missing.push("a chave do Mercado Bitcoin");
  if (!creds.bitso.configured) missing.push("a chave da Bitso");
  if (!settings.bitso_usdt_address || !settings.travel_rule_name) missing.push("o endereço USDT da Bitso e o nome do titular");

  return (
    <Converter
      canOperate={missing.length === 0}
      missing={missing}
      hasMb={creds.mercadobitcoin.configured}
      hasBitso={creds.bitso.configured}
      activeOperation={active ? { id: active.id as string, brl: String(active.brl_amount) } : null}
      limits={{ perOp: s.profile.limit_per_op, perDay: s.profile.limit_per_day, usedToday: used }}
    />
  );
}
