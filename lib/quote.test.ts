import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteFromArs, quoteFromBrl, walkBuyByCost, walkSell, type QuoteInput } from "./quote.ts";
import Decimal from "decimal.js";

const input: QuoteInput = {
  mbAsks: [
    { price: "5.2283", amount: "100" },
    { price: "5.2300", amount: "1000" },
  ],
  bitsoBids: [
    { price: "1602.46", amount: "150" },
    { price: "1601.00", amount: "1000" },
  ],
  mbTakerFee: "0.007",
  bitsoTakerFee: "0.006",
  withdrawFeeUsdt: "0.0094",
  withdrawMinUsdt: "0.24",
};

test("compra percorre os níveis do livro", () => {
  const r = walkBuyByCost(input.mbAsks, new Decimal(1000));
  // 100 USDT a 5,2283 = 522,83 BRL; resto 477,17 / 5,23 = 91,2371 USDT
  assert.equal(r.qty.toFixed(4), "191.2371");
  assert.equal(r.insufficient, false);
});

test("venda percorre os níveis do livro", () => {
  const r = walkSell(input.bitsoBids, new Decimal(200));
  assert.equal(r.proceeds.toFixed(2), new Decimal(150 * 1602.46 + 50 * 1601).toFixed(2));
});

test("cotação de R$ 1.000 desconta as três taxas", () => {
  const q = quoteFromBrl("1000", input);
  const usdtNet = new Decimal("191.2371").mul("0.993");
  assert.equal(q.usdtArrives.slice(0, 7), usdtNet.sub("0.0094").toFixed(6).slice(0, 7));
  assert.ok(Number(q.arsNet) > 300_000 && Number(q.arsNet) < 306_000);
  assert.ok(Number(q.feesInBrl) > 12 && Number(q.feesInBrl) < 15, `taxas ${q.feesInBrl}`);
  assert.deepEqual(q.warnings, []);
});

test("partindo de pesos chega no mesmo resultado (ida e volta)", () => {
  const target = "250000.00";
  const q = quoteFromArs(target, input);
  assert.ok(Number(q.arsNet) >= 250_000, q.arsNet);
  assert.ok(Number(q.arsNet) < 250_000 + 400, q.arsNet); // erro < 1 centavo de real em pesos
});

test("avisa quando falta liquidez", () => {
  const q = quoteFromBrl("100000", input);
  assert.ok(q.warnings.some((w) => w.includes("Mercado Bitcoin")));
});
