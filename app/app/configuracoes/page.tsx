import { pageSession } from "@/lib/server/page-session";
import { credentialStatus, getSettings } from "@/lib/server/credentials";
import { supabaseUser } from "@/lib/server/supabase";
import { maskDestination } from "@/lib/validation";
import { Settings } from "@/components/settings";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const s = await pageSession();
  const sb = await supabaseUser();
  const [creds, settings, { data: accounts }] = await Promise.all([
    credentialStatus(s.userId),
    getSettings(s.userId),
    sb.from("bank_accounts").select("id, label, kind, value").order("created_at"),
  ]);
  return (
    <Settings
      creds={creds}
      destination={{ address: settings.bitso_usdt_address ?? "", holder: settings.travel_rule_name ?? s.profile.full_name ?? "" }}
      accounts={(accounts ?? []).map((a) => ({ id: a.id, label: a.label, masked: maskDestination(a.kind, a.value) }))}
      limits={{ perOp: s.profile.limit_per_op, perDay: s.profile.limit_per_day }}
    />
  );
}
