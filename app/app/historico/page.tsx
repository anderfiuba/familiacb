import Link from "next/link";
import { pageSession } from "@/lib/server/page-session";
import { supabaseUser } from "@/lib/server/supabase";
import { Panel } from "@/components/ui";
import { ars, brl, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Concluída", cls: "bg-real-claro text-[#16683f]" },
  failed: { label: "Parou", cls: "bg-alerta-claro text-alerta" },
};

export default async function HistoricoPage() {
  await pageSession();
  const sb = await supabaseUser();
  const [{ data: ops }, { data: payouts }] = await Promise.all([
    sb.from("operations").select("id, status, brl_amount, ars_received, estimate, created_at").order("created_at", { ascending: false }).limit(100),
    sb.from("payouts").select("id, amount_ars, destination_masked, status, created_at").order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="font-titulo text-[30px] font-semibold leading-tight">Histórico</h1>

      <Panel flush>
        {ops && ops.length > 0 ? (
          <ul className="divide-y divide-linha">
            {ops.map((o) => {
              const s = STATUS[o.status as string] ?? { label: "Em andamento", cls: "bg-peso-claro text-peso" };
              const received = o.ars_received ?? (o.estimate as { arsNet?: string })?.arsNet;
              return (
                <li key={o.id as string}>
                  <Link href={`/app/operacao/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-papel/70 sm:px-6">
                    <span className="space-y-0.5">
                      <span className="block font-titulo text-lg font-semibold">
                        {brl(o.brl_amount as string)} → {o.ars_received ? "" : "≈ "}
                        {ars(received as string)}
                      </span>
                      <span className="block text-sm text-suave">{dateTime(o.created_at as string)}</span>
                    </span>
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${s.cls}`}>{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="space-y-2 px-6 py-12 text-center">
            <p className="font-semibold">Nenhuma conversão ainda.</p>
            <Link href="/app" className="text-peso underline underline-offset-4">
              Fazer a primeira
            </Link>
          </div>
        )}
      </Panel>

      {payouts && payouts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-titulo text-xl font-semibold">Saques em pesos</h2>
          <Panel flush>
            <ul className="divide-y divide-linha">
              {payouts.map((p) => (
                <li key={p.id as string} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <span>
                    <span className="font-semibold">{ars(p.amount_ars as string)}</span>
                    <span className="ml-2 text-sm text-suave">para {p.destination_masked as string}</span>
                  </span>
                  <span className="text-sm text-suave">
                    {p.status === "failed" ? "Recusado" : "Solicitado"} em {dateTime(p.created_at as string)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}
    </div>
  );
}
