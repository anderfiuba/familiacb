"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";
import { api } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { RouteBreakdown } from "./route";
import { Button, Notice, Panel, cx } from "./ui";
import { ars, brl, parseInputMoney, pct, plain, time, usdt } from "@/lib/format";

type Quote = {
  brl: string;
  mbAvgPrice: string;
  usdtGross: string;
  mbFeeUsdt: string;
  usdtNet: string;
  withdrawFeeUsdt: string;
  usdtArrives: string;
  bitsoAvgPrice: string;
  arsGross: string;
  bitsoFeeArs: string;
  arsNet: string;
  rate: string;
  feesInBrl: string;
  feesPct: string;
  warnings: string[];
  mbTakerFee: string;
  bitsoTakerFee: string;
  personalFees: boolean;
  quotedAt: string;
};

type Balances = {
  mercadobitcoin: { ok: true; data: { brl: string; usdt: string } } | { ok: false; message: string } | null;
  bitso: { ok: true; data: { ars: string; usdt: string } } | { ok: false; message: string } | null;
};

const toInput = (v: string) => (Number(v) > 0 ? plain(v) : "");

export function Converter(props: {
  canOperate: boolean;
  missing: string[];
  hasMb: boolean;
  hasBitso: boolean;
  activeOperation: { id: string; brl: string } | null;
  limits: { perOp: number; perDay: number; usedToday: number };
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"brl" | "ars">("brl");
  const [brlText, setBrlText] = useState("1.000,00");
  const [arsText, setArsText] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [confirming, setConfirming] = useState(false);
  const seq = useRef(0);

  const driverText = mode === "brl" ? brlText : arsText;

  const fetchQuote = useCallback(async (m: "brl" | "ars", text: string) => {
    const amount = parseInputMoney(text);
    if (!amount) {
      setQuote(null);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await api<{ quote: Quote }>(`/api/quote?mode=${m}&amount=${amount}`);
      if (my !== seq.current) return; // resposta antiga
      setQuote(r.quote);
      setError(null);
      if (m === "brl") setArsText(toInput(r.quote.arsNet));
      else setBrlText(toInput(r.quote.brl));
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Não foi possível cotar.");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  // Recota ao digitar (com espera) e a cada 15 s
  useEffect(() => {
    const t = setTimeout(() => fetchQuote(mode, driverText), 450);
    return () => clearTimeout(t);
  }, [mode, driverText, fetchQuote]);
  useEffect(() => {
    const i = setInterval(() => !confirming && fetchQuote(mode, driverText), 15_000);
    return () => clearInterval(i);
  }, [mode, driverText, confirming, fetchQuote]);

  useEffect(() => {
    if (props.hasMb || props.hasBitso) api<Balances>("/api/balance").then(setBalances).catch(() => undefined);
  }, [props.hasMb, props.hasBitso]);

  const mbBalance = balances?.mercadobitcoin?.ok ? balances.mercadobitcoin.data.brl : null;
  const remainingToday = Math.max(0, props.limits.perDay - props.limits.usedToday);
  const brlValue = quote ? Number(quote.brl) : 0;

  let blocker: string | null = null;
  if (!props.canOperate) blocker = "Configure suas chaves para operar";
  else if (props.activeOperation) blocker = "Há uma conversão em andamento";
  else if (!quote || loading) blocker = null;
  else if (quote.warnings.length) blocker = quote.warnings[0]!;
  else if (brlValue < 50) blocker = "Mínimo de R$ 50,00";
  else if (brlValue > props.limits.perOp) blocker = `Acima do limite de ${brl(props.limits.perOp)} por operação`;
  else if (brlValue > remainingToday) blocker = `Hoje você ainda pode converter ${brl(remainingToday)}`;
  else if (mbBalance !== null && brlValue > Number(mbBalance)) blocker = "Saldo insuficiente no Mercado Bitcoin";

  async function execute(code: string) {
    const amount = parseInputMoney(driverText);
    if (!amount || !quote) throw new Error("Valor inválido.");
    const r = await api<{ id: string }>("/api/operations", {
      body: { mode, amount, shownRate: quote.rate, totp: code },
    });
    router.push(`/app/operacao/${r.id}`);
  }

  return (
    <div className="space-y-6">
      {props.activeOperation && (
        <Notice tone="info">
          Você tem uma conversão de {brl(props.activeOperation.brl)} em andamento.{" "}
          <Link href={`/app/operacao/${props.activeOperation.id}`} className="font-semibold underline underline-offset-4">
            Acompanhar
          </Link>
        </Notice>
      )}
      {!props.canOperate && (
        <Notice tone="alerta">
          Você pode simular à vontade. Para converter de verdade, falta configurar {props.missing.join(", ")}.{" "}
          <Link href="/app/configuracoes" className="font-semibold underline underline-offset-4">
            Ir para configurações
          </Link>
        </Notice>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel flush className="space-y-6">
          <div className="space-y-1 px-5 pt-6 sm:px-7">
            <h1 className="font-titulo text-[28px] font-semibold leading-tight sm:text-[34px]">Reais para pesos</h1>
            <p className="text-suave">Mercado Bitcoin → USDT pela rede Polygon → Bitso Argentina.</p>
          </div>

          <div className="px-5 sm:px-7">
            <AmountBox
              label="Você envia"
              currency="BRL"
              prefix="R$"
              tone="real"
              value={brlText}
              active={mode === "brl"}
              onChange={(v) => {
                setMode("brl");
                setBrlText(v);
              }}
              footer={
                props.hasMb ? (
                  balances === null ? (
                    <span className="text-suave">Carregando saldo…</span>
                  ) : mbBalance !== null ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        Saldo no Mercado Bitcoin: <strong className="font-semibold text-tinta">{brl(mbBalance)}</strong>
                      </span>
                      {Number(mbBalance) >= 50 && (
                        <button
                          type="button"
                          className="font-semibold text-real underline-offset-4 hover:underline"
                          onClick={() => {
                            setMode("brl");
                            setBrlText(plain(Math.min(Number(mbBalance), props.limits.perOp, remainingToday)));
                          }}
                        >
                          Usar o máximo permitido
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="text-alerta">Saldo indisponível no momento.</span>
                  )
                ) : (
                  <span>
                    <Link href="/app/configuracoes" className="font-semibold text-tinta underline underline-offset-4">
                      Conecte o Mercado Bitcoin
                    </Link>{" "}
                    para ver seu saldo.
                  </span>
                )
              }
            />

            <div className="flex items-center gap-3 py-3 pl-5">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-linha bg-papel">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm text-suave" aria-live="polite">
                {quote && !quote.warnings.length ? (
                  <>
                    1 real ≈ <strong className="font-semibold text-tinta">{ars(quote.rate)}</strong> pesos, já com todas as taxas
                  </>
                ) : loading ? (
                  "Calculando…"
                ) : (
                  "Digite um valor"
                )}
              </span>
              {loading && <RefreshCw className="h-4 w-4 animate-spin text-suave" aria-hidden />}
            </div>

            <AmountBox
              label="Você recebe na Bitso, aproximadamente"
              currency="ARS"
              prefix="$"
              tone="peso"
              value={arsText}
              active={mode === "ars"}
              onChange={(v) => {
                setMode("ars");
                setArsText(v);
              }}
              footer={
                balances?.bitso?.ok ? (
                  <span>
                    Saldo atual na Bitso: <strong className="font-semibold text-tinta">{ars(balances.bitso.data.ars)}</strong>
                  </span>
                ) : (
                  <span>Digite aqui se preferir partir do valor em pesos.</span>
                )
              }
            />
          </div>

          <div className="space-y-3 border-t border-linha bg-papel/60 px-5 py-5 sm:px-7">
            {error && <p className="text-sm text-alerta" role="alert">{error}</p>}
            <Button
              className="w-full py-3.5 text-base"
              disabled={!!blocker || !quote || loading}
              onClick={() => setConfirming(true)}
            >
              {blocker ?? (quote ? `Converter ${brl(quote.brl)} em pesos` : "Converter")}
            </Button>
            <p className="text-center text-sm text-suave">
              Limite: {brl(props.limits.perOp)} por operação e {brl(props.limits.perDay)} por dia. Hoje ainda restam{" "}
              {brl(remainingToday)}.
            </p>
          </div>
        </Panel>

        <Panel className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-titulo text-xl font-semibold">Para onde vai cada real</h2>
            <p className="text-sm text-suave">
              {quote
                ? `Cotação das ${time(quote.quotedAt)}. ${quote.personalFees ? "Taxas da sua conta." : "Taxas padrão das exchanges."}`
                : "A cotação aparece quando você digita um valor."}
            </p>
          </div>
          {quote ? (
            <>
              <RouteBreakdown
                rows={[
                  { kind: "valor", title: "Você envia", value: brl(quote.brl), tone: "real" },
                  {
                    kind: "passo",
                    title: `Compra de USDT a ${brl(quote.mbAvgPrice)}`,
                    note: `Taxa do Mercado Bitcoin ${pct(quote.mbTakerFee)}`,
                    value: `− ${usdt(quote.mbFeeUsdt)}`,
                  },
                  {
                    kind: "passo",
                    title: "Envio pela rede Polygon",
                    note: "Taxa de rede cobrada pelo Mercado Bitcoin",
                    value: `− ${usdt(quote.withdrawFeeUsdt)}`,
                  },
                  { kind: "valor", title: "Chegam na Bitso", value: usdt(quote.usdtArrives), tone: "neutro" },
                  {
                    kind: "passo",
                    title: `Venda a ${ars(quote.bitsoAvgPrice)} por USDT`,
                    note: `Taxa da Bitso ${pct(quote.bitsoTakerFee)}`,
                    value: `− ${ars(quote.bitsoFeeArs)}`,
                  },
                  { kind: "valor", title: "Você recebe", value: ars(quote.arsNet), tone: "peso" },
                ]}
              />
              <div className="rounded-campo bg-papel px-4 py-3 text-sm">
                <p>
                  Custo total das taxas: <strong className="font-semibold">{brl(quote.feesInBrl)}</strong> ({plain(quote.feesPct)}% do valor).
                </p>
                <p className="mt-1 text-suave">Valores aproximados. O preço exato só existe depois da venda na Bitso.</p>
              </div>
            </>
          ) : (
            <div className="grid h-48 place-items-center rounded-campo border border-dashed border-linha text-sm text-suave">
              Sem valor para cotar
            </div>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Confirmar conversão"
        confirmLabel="Converter agora"
        onCancel={() => setConfirming(false)}
        onConfirm={execute}
      >
        {quote && (
          <div className="space-y-3">
            <dl className="divide-y divide-linha rounded-campo border border-linha text-[15px]">
              <Row label="Sai do Mercado Bitcoin" value={brl(quote.brl)} strong />
              <Row label="Chega na Bitso (aprox.)" value={ars(quote.arsNet)} strong />
              <Row label="Cotação com taxas" value={`1 real ≈ ${ars(quote.rate)}`} />
              <Row label="Taxas somadas" value={brl(quote.feesInBrl)} />
            </dl>
            <p className="text-sm text-suave">
              O envio leva alguns minutos. Se o preço na Bitso piorar mais de 2% no momento da venda, ela é cancelada e o
              USDT fica guardado na Bitso até você tentar de novo.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-suave">{label}</dt>
      <dd className={cx(strong ? "font-titulo text-lg font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function AmountBox(props: {
  label: string;
  currency: string;
  prefix: string;
  tone: "real" | "peso";
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  footer: React.ReactNode;
}) {
  const id = `valor-${props.currency}`;
  return (
    <div
      className={cx(
        "rounded-painel border-2 bg-white px-5 py-4 transition-colors focus-within:ring-4 focus-within:ring-peso/15",
        props.active ? (props.tone === "real" ? "border-real" : "border-peso") : "border-linha",
      )}
    >
      <label htmlFor={id} className="text-sm font-semibold text-suave">
        {props.label}
      </label>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cx("font-titulo text-2xl font-semibold", props.tone === "real" ? "text-real" : "text-peso")}>
          {props.prefix}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="0,00"
          className="min-w-0 flex-1 bg-transparent font-titulo text-[34px] font-semibold leading-tight tracking-tight text-tinta outline-none placeholder:text-linha sm:text-[42px]"
        />
        <span className="rounded-full bg-papel px-2.5 py-1 text-sm font-semibold text-suave">{props.currency}</span>
      </div>
      <div className="mt-2 text-sm text-suave">{props.footer}</div>
    </div>
  );
}
