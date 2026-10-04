"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "./api";
import { RouteProgress } from "./route";
import { ConfirmDialog } from "./confirm-dialog";
import { Payout } from "./payout";
import { Button, Notice, Panel, cx } from "./ui";
import { STATIONS, progressOf, type PublicOperation } from "@/lib/steps";
import { ars, brl, plain, time, usdt } from "@/lib/format";

type Event = { id: number; status: string; kind: "info" | "step" | "warning" | "error"; message: string; created_at: string };
type Data = { operation: PublicOperation; events: Event[] };

export function OperationProgress({ initial, accounts }: { initial: Data; accounts: { id: string; label: string; masked: string }[] }) {
  const [data, setData] = useState<Data>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [resuming, setResuming] = useState(false);
  const [netError, setNetError] = useState(false);
  const busy = useRef(false);

  const op = data.operation;
  const done = op.status === "completed";
  const failed = op.status === "failed";
  const running = !done && !failed;

  // Motor: a cada 3 s pede para avançar um passo e lê o estado atualizado.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const tick = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        await api(`/api/operations/${op.id}/advance`, { body: {} }).catch(() => undefined);
        const fresh = await api<Data>(`/api/operations/${op.id}`);
        if (!stop) {
          setData(fresh);
          setNetError(false);
        }
      } catch {
        if (!stop) setNetError(true);
      } finally {
        busy.current = false;
      }
    };
    tick();
    const i = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(i);
    };
  }, [running, op.id]);

  // Relógio para a barra andar suavemente entre as respostas do servidor.
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [running]);

  // Avisa antes de fechar a aba durante a conversão.
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  const pos = failed
    ? progressOf(op.failedAt ?? "created", null)
    : progressOf(op.status, op.updatedAt, now);
  const percent = done ? 100 : Math.round(pos.value * 100);
  const activeStation = failed ? op.failedStation ?? 0 : pos.station;
  const stepLabel = STATIONS[Math.min(activeStation, STATIONS.length - 1)]!;

  async function resume(code: string) {
    await api(`/api/operations/${op.id}/resume`, { body: { totp: code } });
    setResuming(false);
    setData(await api<Data>(`/api/operations/${op.id}`));
  }

  const minutes = Math.max(0, Math.floor((now - new Date(op.createdAt).getTime()) / 60000));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-suave">
            <Link href="/app" className="hover:text-tinta">Converter</Link> / Conversão de {brl(op.brl)}
          </p>
          {done ? (
            <h1 className="font-titulo text-[30px] font-semibold leading-tight sm:text-[40px]">
              Pronto: <span className="text-peso">{ars(op.bitso.arsReceived)}</span> na sua Bitso
            </h1>
          ) : failed ? (
            <h1 className="font-titulo text-[30px] font-semibold leading-tight sm:text-[40px]">
              A conversão parou em “{stepLabel.title}”
            </h1>
          ) : (
            <h1 className="font-titulo text-[30px] font-semibold leading-tight sm:text-[40px]">
              {stepLabel.title}
              <span className="text-suave">…</span>
            </h1>
          )}
          <p className="text-suave" aria-live="polite">
            {done
              ? `Concluída em ${minutes} min. O valor abaixo é o exato, já descontadas todas as taxas.`
              : failed
                ? "Nada se perdeu: veja abaixo onde está o seu dinheiro agora."
                : `Etapa ${activeStation + 1} de 4. ${stepLabel.detail}. ${minutes > 0 ? `${minutes} min desde o início.` : ""}`}
          </p>
        </div>
        <div className="text-right">
          <span className={cx("font-titulo text-[44px] font-semibold leading-none", done ? "text-peso" : failed ? "text-alerta" : "text-tinta")}>
            {percent}%
          </span>
        </div>
      </div>

      <Panel flush className="px-5 py-7 sm:px-8 sm:py-9">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Progresso da conversão"
        >
          <RouteProgress
            progress={done ? 1 : pos.value}
            active={activeStation}
            failed={failed ? activeStation : null}
            done={done}
            arrivalLabel={done ? ars(op.bitso.arsReceived) : `≈ ${ars(op.estimate.arsNet)}`}
          />
        </div>
      </Panel>

      {netError && running && <Notice tone="alerta">Sem conexão com o servidor. Tentando de novo…</Notice>}

      {failed && (
        <Panel className="space-y-4 border-alerta/40">
          <h2 className="font-titulo text-xl font-semibold">O que aconteceu</h2>
          <p>{op.error}</p>
          <WhereIsMoney op={op} />
          {op.canResume ? (
            <Button onClick={() => setResuming(true)}>Tentar de novo a partir daqui</Button>
          ) : (
            <Link href="/app" className="inline-block font-semibold text-peso underline underline-offset-4">
              Voltar ao conversor
            </Link>
          )}
        </Panel>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel className="space-y-4">
          <h2 className="font-titulo text-xl font-semibold">Linha do tempo</h2>
          <ol className="space-y-3">
            {data.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-[15px]">
                <span className="w-[72px] shrink-0 pt-px text-sm tabular-nums text-suave">{time(e.created_at)}</span>
                <span
                  className={cx(
                    e.kind === "error" && "text-alerta",
                    e.kind === "warning" && "text-[#8a5a00]",
                    e.kind === "info" && "text-suave",
                  )}
                >
                  {e.message}
                </span>
              </li>
            ))}
            {running && (
              <li className="flex gap-3 text-[15px] text-suave">
                <span className="w-[72px] shrink-0 text-sm">agora</span>
                <span>{stepLabel.detail}…</span>
              </li>
            )}
          </ol>
          {running && (
            <p className="rounded-campo bg-papel px-4 py-3 text-sm text-suave">
              Mantenha esta página aberta. Se fechar, a conversão continua do ponto em que parou quando você abrir o familiacb de novo.
            </p>
          )}
        </Panel>

        {done ? (
          <div className="space-y-6">
            <ResultTable op={op} />
            <Payout operationId={op.id} suggested={op.bitso.arsReceived ?? "0"} accounts={accounts} />
          </div>
        ) : (
          <Panel className="space-y-4">
            <h2 className="font-titulo text-xl font-semibold">Estimativa da confirmação</h2>
            <dl className="divide-y divide-linha text-[15px]">
              <Line label="Você enviou" value={brl(op.brl)} />
              <Line label="USDT esperados na Bitso" value={usdt(op.estimate.usdtArrives)} />
              <Line label="Pesos esperados" value={ars(op.estimate.arsNet)} />
              <Line label="Cotação estimada" value={`1 real ≈ ${ars(op.estimate.rate)}`} />
            </dl>
            <p className="text-sm text-suave">O valor exato aparece aqui quando a venda na Bitso terminar.</p>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={resuming}
        title="Retomar a conversão"
        confirmLabel="Retomar"
        onCancel={() => setResuming(false)}
        onConfirm={resume}
      >
        <p className="text-[15px] text-suave">A conversão continua do ponto em que parou, com os preços de agora.</p>
      </ConfirmDialog>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-suave">{label}</dt>
      <dd className={cx("text-right", strong ? "font-titulo text-lg font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function WhereIsMoney({ op }: { op: PublicOperation }) {
  const at = op.failedAt ?? "created";
  let text = "Seus reais continuam no Mercado Bitcoin. Nenhuma compra foi feita.";
  if (["mb_bought", "mb_withdraw_submitting"].includes(at)) text = "Os USDT comprados estão no Mercado Bitcoin.";
  if (at === "mb_withdraw_submitted") text = "O envio de USDT foi solicitado no Mercado Bitcoin. Confira o status do saque por lá.";
  if (["bitso_waiting", "bitso_sell_submitting", "bitso_sell_submitted"].includes(at)) {
    text = "Os USDT estão na Bitso, aguardando a venda.";
  }
  if (at === "mb_buy_submitting") text = "Confira no Mercado Bitcoin se a compra de USDT foi executada.";
  return <Notice tone="info">{text}</Notice>;
}

function ResultTable({ op }: { op: PublicOperation }) {
  const finalRate = Number(op.brl) > 0 ? Number(op.bitso.arsReceived ?? 0) / Number(op.brl) : 0;
  const diff = Number(op.bitso.arsReceived ?? 0) - Number(op.estimate.arsNet);
  const usdtNet = Number(op.mb.usdtBought ?? 0) - Number(op.mb.feeUsdt ?? 0);
  const rows: { step: string; price: string; amount: string; fee: string }[] = [
    {
      step: "Compra de USDT (Mercado Bitcoin)",
      price: `${brl(op.mb.avgPrice)} / USDT`,
      amount: `${brl(op.brl)} → ${usdt(usdtNet)}`,
      fee: usdt(op.mb.feeUsdt),
    },
    {
      step: "Envio pela rede Polygon",
      price: "—",
      amount: `${usdt(op.mb.usdtSent)} enviados`,
      fee: usdt(op.mb.withdrawFee),
    },
    {
      step: "Venda por pesos (Bitso)",
      price: `${ars(op.bitso.avgPrice)} / USDT`,
      amount: `${usdt(op.bitso.usdtSold)} → ${ars(op.bitso.arsReceived)}`,
      fee: ars(op.bitso.feeArs),
    },
  ];
  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-titulo text-xl font-semibold">Conversão executada</h2>
        <span className="text-sm text-suave">
          {diff >= 0 ? `${ars(diff)} acima` : `${ars(Math.abs(diff))} abaixo`} da estimativa
        </span>
      </div>
      <div className="-mx-5 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[520px] text-left text-[15px]">
          <thead>
            <tr className="border-b border-linha text-sm text-suave">
              <th className="px-5 py-2 font-semibold sm:px-0">Etapa</th>
              <th className="px-3 py-2 font-semibold">Cotação</th>
              <th className="px-3 py-2 font-semibold">Valores</th>
              <th className="px-5 py-2 text-right font-semibold sm:px-0">Taxa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linha">
            {rows.map((r) => (
              <tr key={r.step}>
                <td className="px-5 py-3 font-medium sm:px-0">{r.step}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{r.price}</td>
                <td className="px-3 py-3 tabular-nums">{r.amount}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-suave sm:px-0">{r.fee}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-tinta">
              <td className="px-5 py-3 font-semibold sm:px-0">Cotação final</td>
              <td className="px-3 py-3 font-titulo text-lg font-semibold" colSpan={2}>
                1 real = {ars(finalRate.toFixed(4))}
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-right font-titulo text-lg font-semibold text-peso sm:px-0">{ars(op.bitso.arsReceived)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {op.mb.tx && (
        <a
          href={`https://polygonscan.com/tx/${encodeURIComponent(op.mb.tx)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-peso underline-offset-4 hover:underline"
        >
          Ver a transferência na Polygonscan <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
      <p className="text-sm text-suave">Cotação do real calculada sobre {plain(op.brl)} reais enviados.</p>
    </Panel>
  );
}
