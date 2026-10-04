/**
 * Motor de cotação — puro, sem rede. Usado no servidor (estimativa oficial salva na operação)
 * e testado isoladamente. Todos os valores monetários usam Decimal (nada de float).
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Level = { price: string; amount: string };

export type QuoteInput = {
  mbAsks: Level[]; // livro USDT-BRL do Mercado Bitcoin, asks em ordem crescente de preço
  bitsoBids: Level[]; // livro usdt_ars da Bitso, bids em ordem decrescente de preço
  mbTakerFee: string; // fração (0.007 = 0,70%)
  bitsoTakerFee: string; // fração
  withdrawFeeUsdt: string; // taxa de rede cobrada pelo MB (Polygon)
  withdrawMinUsdt: string;
};

export type Breakdown = {
  brl: string;
  mbAvgPrice: string; // BRL por USDT
  usdtGross: string;
  mbFeeUsdt: string;
  usdtNet: string;
  withdrawFeeUsdt: string;
  usdtArrives: string;
  bitsoAvgPrice: string; // ARS por USDT
  arsGross: string;
  bitsoFeeArs: string;
  arsNet: string;
  rate: string; // ARS por BRL, já com todas as taxas
  feesInBrl: string; // custo total aproximado das taxas, em BRL
  feesPct: string; // percentual do valor enviado
  warnings: string[];
};

/** Compra a mercado gastando `cost` na moeda de cotação. */
export function walkBuyByCost(asks: Level[], cost: Decimal) {
  let remaining = cost;
  let qty = new Decimal(0);
  for (const l of asks) {
    const price = new Decimal(l.price);
    const amount = new Decimal(l.amount);
    if (price.lte(0) || amount.lte(0)) continue;
    const levelCost = price.mul(amount);
    if (levelCost.gte(remaining)) {
      qty = qty.add(remaining.div(price));
      remaining = new Decimal(0);
      break;
    }
    qty = qty.add(amount);
    remaining = remaining.sub(levelCost);
  }
  const spent = cost.sub(remaining);
  return {
    qty,
    avgPrice: qty.gt(0) ? spent.div(qty) : new Decimal(0),
    insufficient: remaining.gt(0),
  };
}

/** Venda a mercado de `qty` unidades da moeda base. */
export function walkSell(bids: Level[], qty: Decimal) {
  let remaining = qty;
  let proceeds = new Decimal(0);
  for (const l of bids) {
    const price = new Decimal(l.price);
    const amount = new Decimal(l.amount);
    if (price.lte(0) || amount.lte(0)) continue;
    const take = Decimal.min(amount, remaining);
    proceeds = proceeds.add(take.mul(price));
    remaining = remaining.sub(take);
    if (remaining.lte(0)) break;
  }
  const sold = qty.sub(remaining);
  return {
    proceeds,
    avgPrice: sold.gt(0) ? proceeds.div(sold) : new Decimal(0),
    insufficient: remaining.gt(0),
  };
}

export function quoteFromBrl(brlIn: string | number, q: QuoteInput): Breakdown {
  const brl = new Decimal(brlIn);
  const warnings: string[] = [];

  const buy = walkBuyByCost(q.mbAsks, brl);
  if (buy.insufficient) warnings.push("Liquidez insuficiente no Mercado Bitcoin para este valor.");

  // A taxa de compra do MB é descontada em USDT (moeda recebida).
  const mbFee = buy.qty.mul(q.mbTakerFee);
  const usdtNet = buy.qty.sub(mbFee);
  const wFee = new Decimal(q.withdrawFeeUsdt);
  const usdtArrives = Decimal.max(usdtNet.sub(wFee), 0);
  if (usdtNet.lt(q.withdrawMinUsdt)) warnings.push("Valor abaixo do mínimo de envio de USDT.");

  const sell = walkSell(q.bitsoBids, usdtArrives);
  if (sell.insufficient) warnings.push("Liquidez insuficiente na Bitso para este valor.");

  const bitsoFee = sell.proceeds.mul(q.bitsoTakerFee);
  const arsNet = sell.proceeds.sub(bitsoFee);
  const rate = brl.gt(0) ? arsNet.div(brl) : new Decimal(0);

  // Custo das taxas em BRL: compara com o cenário "sem taxas" nos mesmos preços médios.
  const arsNoFees = buy.qty.mul(sell.avgPrice);
  const lostArs = Decimal.max(arsNoFees.sub(arsNet), 0);
  const feesInBrl = arsNoFees.gt(0) ? lostArs.div(arsNoFees.div(brl)) : new Decimal(0);

  return {
    brl: brl.toFixed(2),
    mbAvgPrice: buy.avgPrice.toFixed(4),
    usdtGross: buy.qty.toFixed(6),
    mbFeeUsdt: mbFee.toFixed(6),
    usdtNet: usdtNet.toFixed(6),
    withdrawFeeUsdt: wFee.toFixed(6),
    usdtArrives: usdtArrives.toFixed(6),
    bitsoAvgPrice: sell.avgPrice.toFixed(2),
    arsGross: sell.proceeds.toFixed(2),
    bitsoFeeArs: bitsoFee.toFixed(2),
    arsNet: arsNet.toFixed(2),
    rate: rate.toFixed(4),
    feesInBrl: feesInBrl.toFixed(2),
    feesPct: brl.gt(0) ? feesInBrl.div(brl).mul(100).toFixed(2) : "0.00",
    warnings,
  };
}

/** Descobre quantos BRL são necessários para receber `ars` (busca binária sobre a função acima). */
export function quoteFromArs(arsIn: string | number, q: QuoteInput): Breakdown {
  const target = new Decimal(arsIn);
  const first = quoteFromBrl(1000, q);
  const r = new Decimal(first.rate);
  if (r.lte(0)) return quoteFromBrl(0, q);

  let lo = target.div(r).mul(0.8);
  let hi = target.div(r).mul(1.25).add(5);
  for (let i = 0; i < 40; i++) {
    const mid = lo.add(hi).div(2);
    const got = new Decimal(quoteFromBrl(mid.toFixed(2), q).arsNet);
    if (got.lt(target)) lo = mid;
    else hi = mid;
    if (hi.sub(lo).lt(0.01)) break;
  }
  return quoteFromBrl(hi.toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2), q);
}
