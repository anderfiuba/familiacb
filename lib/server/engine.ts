import "server-only";
import Decimal from "decimal.js";
import { supabaseAdmin } from "./supabase";
import { clientsFor } from "./credentials";
import { ExchangeError } from "./exchanges/http";
import { MercadoBitcoin } from "./exchanges/mercadobitcoin";
import type { Bitso } from "./exchanges/bitso";

/**
 * Máquina de estados da conversão. Cada chamada a `advance` executa NO MÁXIMO um passo,
 * sob um lock no banco (lock_until), e é idempotente: chamadas repetidas ou concorrentes
 * nunca disparam a mesma ação duas vezes na exchange.
 *
 *  created
 *   → mb_buy_submitting → mb_buy_submitted → mb_bought
 *   → mb_withdraw_submitting → mb_withdraw_submitted
 *   → bitso_waiting
 *   → bitso_sell_submitting → bitso_sell_submitted
 *   → completed            (ou failed, com failed_at_status)
 */
export type OpStatus =
  | "created"
  | "mb_buy_submitting"
  | "mb_buy_submitted"
  | "mb_bought"
  | "mb_withdraw_submitting"
  | "mb_withdraw_submitted"
  | "bitso_waiting"
  | "bitso_sell_submitting"
  | "bitso_sell_submitted"
  | "completed"
  | "failed";

export type Operation = {
  id: string;
  user_id: string;
  status: OpStatus;
  failed_at_status: OpStatus | null;
  error_message: string | null;
  brl_amount: string;
  estimate: Record<string, unknown>;
  mb_external_id: string;
  mb_order_id: string | null;
  mb_avg_price: string | null;
  usdt_bought: string | null;
  mb_trade_fee_usdt: string | null;
  mb_withdraw_id: string | null;
  mb_withdraw_fee: string | null;
  usdt_withdrawn: string | null;
  withdraw_tx: string | null;
  withdraw_sent_at: string | null;
  bitso_funding_id: string | null;
  usdt_received: string | null;
  bitso_origin_id: string;
  bitso_order_id: string | null;
  usdt_sold: string | null;
  bitso_avg_price: string | null;
  bitso_fee_ars: string | null;
  ars_received: string | null;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
};

const SLIPPAGE_PCT = "2"; // a Bitso cancela a venda se o preço piorar mais que isso durante a execução
const db = () => supabaseAdmin();
/** Número formatado em pt-BR para as mensagens da linha do tempo. */
const n = (v: Decimal | string, digits = 2) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v.toString()));

async function event(op: Operation, kind: "info" | "step" | "warning" | "error", message: string, data?: object) {
  await db()
    .from("operation_events")
    .insert({ operation_id: op.id, user_id: op.user_id, status: op.status, kind, message, data: data ?? null } as never);
}

async function patch(op: Operation, fields: Partial<Operation> & Record<string, unknown>) {
  const { data, error } = await db()
    .from("operations")
    // updated_at marca a ÚLTIMA MUDANÇA DE ESTADO (usada em timeouts e no progresso da tela)
    .update({ ...fields, ...(fields.status ? { updated_at: new Date().toISOString() } : {}) } as never)
    .eq("id", op.id)
    .eq("status", op.status) // compare-and-set: só avança a partir do estado esperado
    .select("*")
    .single<Operation>();
  if (error || !data) throw new Error("Transição de estado concorrente");
  return data;
}

async function fail(op: Operation, message: string) {
  await event(op, "error", message);
  return patch(op, { status: "failed", failed_at_status: op.status, error_message: message });
}

const unixSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) - 60;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Tenta pegar o lock por 25 s. Retorna null se outra requisição já está trabalhando. */
async function claim(opId: string, userId: string): Promise<Operation | null> {
  const now = new Date().toISOString();
  const { data } = await db()
    .from("operations")
    .update({ lock_until: later(25_000) } as never)
    .eq("id", opId)
    .eq("user_id", userId)
    .or(`lock_until.is.null,lock_until.lt.${now}`)
    .select("*")
    .maybeSingle<Operation>();
  return data ?? null;
}

async function release(opId: string) {
  await db().from("operations").update({ lock_until: null } as never).eq("id", opId);
}

export async function advance(opId: string, userId: string): Promise<void> {
  const op = await claim(opId, userId);
  if (!op) return; // já tem alguém processando
  try {
    if (op.status === "completed" || op.status === "failed") return;
    if (op.next_check_at && new Date(op.next_check_at).getTime() > Date.now()) return;

    const { mb, bitso, settings } = await clientsFor(userId);
    await step(op, mb, bitso, settings);
  } catch (err) {
    if (err instanceof ExchangeError && err.transient) {
      // rede/instabilidade: tenta de novo em alguns segundos, sem falhar a operação
      await db().from("operations").update({ next_check_at: later(8_000) } as never).eq("id", op.id);
      await event(op, "warning", "Exchange instável, tentando de novo em instantes.", { exchange: err.exchange });
    } else if (err instanceof ExchangeError) {
      // Relê o estado: o passo pode ter mudado o status antes do erro (ex.: *_submitting).
      const { data: fresh } = await db().from("operations").select("*").eq("id", op.id).single<Operation>();
      const current = fresh ?? op;
      if (current.status === "completed" || current.status === "failed") return;
      const message = `${err.exchange === "bitso" ? "Bitso" : "Mercado Bitcoin"}: ${err.message}`;
      await event(current, "error", message);
      // Recusa definitiva (4xx) ao pedir o saque: nada saiu do MB, então é seguro retomar de "mb_bought".
      const rejected = err.status >= 400 && err.status < 500;
      const failedAt = current.status === "mb_withdraw_submitting" && rejected ? "mb_bought" : current.status;
      await db()
        .from("operations")
        .update({ status: "failed", failed_at_status: failedAt, error_message: message, updated_at: new Date().toISOString() } as never)
        .eq("id", current.id)
        .eq("status", current.status);
    } else if (err instanceof Error && err.message === "Transição de estado concorrente") {
      // outro processo avançou; nada a fazer
    } else {
      throw err;
    }
  } finally {
    await release(op.id);
  }
}

async function step(
  op: Operation,
  mb: MercadoBitcoin,
  bitso: Bitso,
  settings: { bitso_usdt_address: string | null; travel_rule_name: string | null },
) {
  switch (op.status) {
    // ---------------------------------------------------------------- 1. compra no MB
    case "created": {
      const bal = await mb.balances();
      if (new Decimal(bal.brl).lt(op.brl_amount)) {
        return fail(op, `Saldo insuficiente no Mercado Bitcoin (disponível R$ ${n(bal.brl)}).`);
      }
      // Marca ANTES de enviar: se cair no meio, a recuperação procura pelo externalId.
      const marked = await patch(op, { status: "mb_buy_submitting" });
      const orderId = await mb.placeMarketBuy(op.brl_amount, op.mb_external_id);
      await patch(marked, { status: "mb_buy_submitted", mb_order_id: orderId });
      return event(marked, "step", "Ordem de compra de USDT enviada ao Mercado Bitcoin.");
    }
    case "mb_buy_submitting": {
      const found = await mb.findOrderByExternalId(op.mb_external_id, unixSeconds(op.created_at));
      if (found) return patch(op, { status: "mb_buy_submitted", mb_order_id: found.id });
      if (Date.now() - new Date(op.updated_at).getTime() > 120_000) {
        return fail(op, "Não foi possível confirmar a ordem de compra. Verifique o histórico no Mercado Bitcoin antes de tentar de novo.");
      }
      return patch(op, { next_check_at: later(5_000) });
    }
    case "mb_buy_submitted": {
      const o = await mb.getOrder(op.mb_order_id!);
      if (o.status === "cancelled" && new Decimal(o.filledQty || 0).lte(0)) {
        return fail(op, "A ordem de compra foi cancelada pelo Mercado Bitcoin sem execução.");
      }
      if (o.status !== "filled" && o.status !== "cancelled") return patch(op, { next_check_at: later(2_000) });

      const filled = new Decimal(o.filledQty || 0);
      const fee = new Decimal(o.fee || 0);
      const updated = await patch(op, {
        status: "mb_bought",
        usdt_bought: filled.toFixed(8),
        mb_trade_fee_usdt: fee.toFixed(8),
        mb_avg_price: new Decimal(o.avgPrice || 0).toFixed(8),
      });
      return event(updated, "step", `Comprados ${n(filled.sub(fee), 4)} USDT no Mercado Bitcoin.`);
    }

    // ---------------------------------------------------------------- 2. envio para a Bitso
    case "mb_bought": {
      const address = settings.bitso_usdt_address;
      const holder = settings.travel_rule_name;
      if (!address || !holder) {
        return fail(op, "Falta configurar o endereço USDT (Polygon) da Bitso ou o nome do titular.");
      }
      const [{ fee, minimum }, bal] = await Promise.all([MercadoBitcoin.withdrawFee("USDT", "polygon"), mb.balances()]);
      const net = new Decimal(op.usdt_bought!).sub(op.mb_trade_fee_usdt ?? 0);
      // Nunca envia mais do que esta operação comprou, nem mais que o disponível.
      const qty = Decimal.min(net, new Decimal(bal.usdt)).toDecimalPlaces(6, Decimal.ROUND_DOWN);
      if (qty.lt(minimum)) return fail(op, `Quantidade de USDT abaixo do mínimo de envio (${minimum}).`);

      const description = `familiacb ${op.id.slice(0, 8)}`;
      const marked = await patch(op, { status: "mb_withdraw_submitting", mb_withdraw_fee: fee });
      const w = await mb.withdrawUsdt({
        address,
        quantity: qty.toFixed(6),
        txFee: fee,
        description,
        holderName: holder,
      });
      const updated = await patch(marked, {
        status: "mb_withdraw_submitted",
        mb_withdraw_id: String(w.id),
        usdt_withdrawn: new Decimal(w.net_quantity || qty.sub(fee)).toFixed(8),
        withdraw_sent_at: new Date().toISOString(),
      });
      return event(updated, "step", `Envio de ${n(qty, 4)} USDT para a Bitso solicitado (rede Polygon).`);
    }
    case "mb_withdraw_submitting": {
      const found = await mb.findWithdrawByDescription(`familiacb ${op.id.slice(0, 8)}`, unixSeconds(op.created_at));
      if (found) {
        return patch(op, {
          status: "mb_withdraw_submitted",
          mb_withdraw_id: String(found.id),
          withdraw_sent_at: new Date().toISOString(),
        });
      }
      if (Date.now() - new Date(op.updated_at).getTime() > 120_000) {
        return fail(op, "Não foi possível confirmar o envio do USDT. Verifique os saques no Mercado Bitcoin antes de tentar de novo.");
      }
      return patch(op, { next_check_at: later(5_000) });
    }
    case "mb_withdraw_submitted": {
      const w = await mb.getWithdraw(op.mb_withdraw_id!);
      if (w.status === 3) return fail(op, "O Mercado Bitcoin cancelou o envio do USDT. O saldo volta para a sua conta no MB.");
      if (w.status !== 2) return patch(op, { next_check_at: later(5_000) });
      const updated = await patch(op, {
        status: "bitso_waiting",
        withdraw_tx: w.tx ?? null,
        usdt_withdrawn: new Decimal(w.net_quantity || op.usdt_withdrawn || 0).toFixed(8),
      });
      return event(updated, "step", "USDT enviado pela rede Polygon. Aguardando a Bitso creditar.");
    }

    // ---------------------------------------------------------------- 3. depósito na Bitso
    case "bitso_waiting": {
      const list = await bitso.fundings(50);
      const sentAt = new Date(op.withdraw_sent_at ?? op.created_at).getTime() - 5 * 60_000;
      const expected = new Decimal(op.usdt_withdrawn ?? 0);
      const txOf = (f: (typeof list)[number]) => f.details?.tx_hash ?? f.details?.txHash ?? f.details?.transaction_hash;

      // Fundings já usados por outras operações deste usuário não podem ser reaproveitados.
      const { data: used } = await db()
        .from("operations")
        .select("bitso_funding_id")
        .eq("user_id", op.user_id)
        .not("bitso_funding_id", "is", null);
      const usedIds = new Set((used ?? []).map((r) => (r as { bitso_funding_id: string }).bitso_funding_id));

      const candidates = list.filter(
        (f) => f.currency === "usdt" && !usedIds.has(f.fid) && new Date(f.created_at).getTime() >= sentAt,
      );
      const match =
        (op.withdraw_tx && candidates.find((f) => txOf(f)?.toLowerCase() === op.withdraw_tx!.toLowerCase())) ||
        candidates.find((f) => new Decimal(f.amount).sub(expected).abs().lte("0.000001"));

      if (!match) return patch(op, { next_check_at: later(6_000) });
      if (match.status === "failed") return fail(op, "A Bitso recusou o depósito de USDT. Fale com o suporte da Bitso.");
      if (match.status !== "complete") return patch(op, { bitso_funding_id: null, next_check_at: later(6_000) });

      const updated = await patch(op, {
        status: "bitso_sell_submitting",
        bitso_funding_id: match.fid,
        usdt_received: new Decimal(match.amount).toFixed(8),
      });
      await event(updated, "step", `Bitso creditou ${n(match.amount, 4)} USDT.`);
      return sell(updated, bitso);
    }

    // ---------------------------------------------------------------- 4. venda por pesos
    case "bitso_sell_submitting":
      return sell(op, bitso);
    case "bitso_sell_submitted": {
      const trades = await bitso.orderTradesByOrigin(op.bitso_origin_id);
      const sold = trades.reduce((s, t) => s.add(new Decimal(t.major).abs()), new Decimal(0));
      const target = new Decimal(op.usdt_sold ?? 0);
      const open = await bitso.ordersByOrigin(op.bitso_origin_id).catch(() => []);
      const stillOpen = open.some((o) => o.status === "open" || o.status === "queued" || o.status === "partially filled");
      if (stillOpen) return patch(op, { next_check_at: later(2_000) });
      if (trades.length === 0) {
        // Sem execução e sem ordem aberta: a Bitso cancelou (proteção de slippage) ou ainda está registrando.
        if (Date.now() - new Date(op.updated_at).getTime() < 20_000) return patch(op, { next_check_at: later(2_000) });
        return fail(op, "A Bitso cancelou a venda porque o preço mudou mais de 2%. Seus USDT seguem na Bitso; toque em Tentar de novo.");
      }
      if (sold.lt(target.mul("0.999"))) {
        await event(op, "warning", `Venda parcial: ${n(sold, 4)} de ${n(target, 4)} USDT. O restante ficou na Bitso.`);
      }

      const gross = trades.reduce((s, t) => s.add(new Decimal(t.minor).abs()), new Decimal(0));
      const feeArs = trades
        .filter((t) => t.fees_currency === "ars")
        .reduce((s, t) => s.add(new Decimal(t.fees_amount).abs()), new Decimal(0));
      const net = gross.sub(feeArs);
      const updated = await patch(op, {
        status: "completed",
        usdt_sold: sold.toFixed(8),
        bitso_avg_price: sold.gt(0) ? gross.div(sold).toFixed(8) : "0",
        bitso_fee_ars: feeArs.toFixed(2),
        ars_received: net.toFixed(2),
        bitso_order_id: trades[0]?.oid ?? op.bitso_order_id,
        completed_at: new Date().toISOString(),
      });
      return event(updated, "step", `Conversão concluída: $ ${n(net)} pesos na sua Bitso.`);
    }
  }
}

async function sell(op: Operation, bitso: Bitso) {
  // Se uma venda com este origin_id já existe (resposta perdida), só acompanha.
  const existing = await bitso.orderTradesByOrigin(op.bitso_origin_id).catch(() => []);
  if (existing.length > 0) {
    return patch(op, { status: "bitso_sell_submitted", usdt_sold: op.usdt_sold ?? op.usdt_received });
  }
  const bal = await bitso.balances();
  const qty = Decimal.min(new Decimal(op.usdt_received ?? 0), new Decimal(bal.usdt)).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (qty.lte(0)) return fail(op, "Saldo de USDT na Bitso insuficiente para vender.");

  const r = await bitso.placeMarketSell(qty.toFixed(2), op.bitso_origin_id, SLIPPAGE_PCT);
  const updated = await patch(op, { status: "bitso_sell_submitted", bitso_order_id: r.oid, usdt_sold: qty.toFixed(8) });
  return event(updated, "step", `Venda de ${n(qty)} USDT por pesos enviada à Bitso.`);
}

/** Retomar após falha: só nos pontos em que é seguro (nenhuma ação pendente na exchange). */
export const RESUMABLE: Partial<Record<OpStatus, OpStatus>> = {
  mb_bought: "mb_bought",
  bitso_waiting: "bitso_waiting",
  bitso_sell_submitting: "bitso_sell_submitting",
  mb_withdraw_submitted: "mb_withdraw_submitted",
  bitso_sell_submitted: "bitso_sell_submitted",
};
