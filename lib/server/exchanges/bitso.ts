import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { ExchangeError, request } from "./http";
import type { Level } from "@/lib/quote";

/**
 * Cliente da API v3 da Bitso.
 * Referência: https://docs.bitso.com/bitso-api/docs/api-overview
 *  - Assinatura: HMAC-SHA256(nonce + método + caminho + corpo), header "Bitso key:nonce:assinatura"
 *  - Nonce v2: 13 dígitos de epoch em ms + sal aleatório de 1–6 dígitos
 */
const HOST = "https://api.bitso.com";

export type BitsoCredentials = { apiKey: string; apiSecret: string };

type Envelope<T> = { success: boolean; payload?: T; error?: { code?: string; message?: string } };

function nonceV2() {
  return `${Date.now()}${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
}

function unwrap<T>(status: number, json: unknown, fallback: string): T {
  const j = json as Envelope<T> | null;
  if (status >= 200 && status < 300 && j?.success && j.payload !== undefined) return j.payload;
  const code = j?.error?.code ?? `HTTP_${status}`;
  // Códigos 0201/0202/... (auth) e 08xx (throttling) — ver "Error Categories" da Bitso
  const transient = code.startsWith("08");
  throw new ExchangeError("bitso", status, code, j?.error?.message ?? fallback, transient);
}

export class Bitso {
  constructor(private creds: BitsoCredentials) {}

  // ------------------------------------------------------------------ público
  static async orderbook(book = "usdt_ars"): Promise<{ asks: Level[]; bids: Level[] }> {
    const { status, json } = await request("bitso", `${HOST}/api/v3/order_book?book=${book}&aggregate=true`, {});
    const p = unwrap<{ asks: { price: string; amount: string }[]; bids: { price: string; amount: string }[] }>(
      status,
      json,
      "Falha ao ler o livro da Bitso.",
    );
    const asks = p.asks.map((l) => ({ price: l.price, amount: l.amount })).sort((a, b) => Number(a.price) - Number(b.price));
    const bids = p.bids.map((l) => ({ price: l.price, amount: l.amount })).sort((a, b) => Number(b.price) - Number(a.price));
    return { asks, bids };
  }

  // ------------------------------------------------------------------ privado
  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const nonce = nonceV2();
    const payload = body ? JSON.stringify(body) : "";
    const signature = createHmac("sha256", this.creds.apiSecret).update(`${nonce}${method}${path}${payload}`).digest("hex");
    const { status, json } = await request("bitso", `${HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bitso ${this.creds.apiKey}:${nonce}:${signature}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: payload || undefined,
    });
    return unwrap<T>(status, json, "A Bitso recusou a solicitação.");
  }

  async balances() {
    const p = await this.call<{ balances: { currency: string; available: string; total: string }[] }>(
      "GET",
      "/api/v3/balance",
    );
    const pick = (c: string) => p.balances.find((b) => b.currency === c)?.available ?? "0";
    return { ars: pick("ars"), usdt: pick("usdt") };
  }

  /** Taxa taker (fração) do livro usdt_ars para esta conta. */
  async takerFee(book = "usdt_ars"): Promise<string> {
    const p = await this.call<{ fees: { book: string; fee_decimal?: string; taker_fee_decimal?: string }[] }>(
      "GET",
      "/api/v3/fees",
    );
    const f = p.fees.find((x) => x.book === book);
    return String(f?.taker_fee_decimal ?? f?.fee_decimal ?? "0.006");
  }

  /** Endereço de depósito de USDT na rede Polygon desta conta. */
  async usdtPolygonAddress(): Promise<string | null> {
    try {
      const p = await this.call<{ account_identifier?: string; account_identifier_name?: string }>(
        "GET",
        "/api/v3/funding_destination?fund_currency=usdt&network=polygon",
      );
      return p.account_identifier ?? null;
    } catch {
      return null; // a tela de configurações permite informar manualmente
    }
  }

  async fundings(limit = 50) {
    return this.call<
      {
        fid: string;
        status: "pending" | "complete" | "failed" | string;
        currency: string;
        method?: string;
        network?: string;
        amount: string;
        created_at: string;
        details?: { tx_hash?: string; txHash?: string; transaction_hash?: string };
      }[]
    >("GET", `/api/v3/fundings?limit=${limit}`);
  }

  async placeMarketSell(major: string, originId: string, slippagePct: string) {
    return this.call<{ oid: string }>("POST", "/api/v3/orders", {
      book: "usdt_ars",
      side: "sell",
      type: "market",
      major,
      origin_id: originId,
      slippage_tolerance: slippagePct,
    });
  }

  async orderTradesByOrigin(originId: string) {
    return this.call<
      { major: string; minor: string; price: string; fees_amount: string; fees_currency: string; oid: string; created_at: string }[]
    >("GET", `/api/v3/order_trades?origin_id=${encodeURIComponent(originId)}`);
  }

  async ordersByOrigin(originId: string) {
    return this.call<{ oid: string; status: string; original_amount: string; unfilled_amount: string }[]>(
      "GET",
      `/api/v3/orders?origin_ids=${encodeURIComponent(originId)}`,
    );
  }

  /** Métodos de saque de ARS habilitados para a conta (define os campos exigidos). */
  async arsWithdrawalMethods() {
    return this.call<
      { method: string; name?: string; required_fields?: string[]; legal_operation_entity?: string }[]
    >("GET", "/api/v3/withdrawal_methods/ars");
  }

  async withdrawArs(p: { method: string; amount: string; originId: string; fields: Record<string, string> }) {
    return this.call<{ wid: string; status: string; amount: string }>("POST", "/api/v3/withdrawals", {
      currency: "ars",
      method: p.method,
      amount: p.amount,
      origin_id: p.originId,
      ...p.fields,
    });
  }

  async withdrawalByOrigin(originId: string) {
    return this.call<{ wid: string; status: string; amount: string }[]>(
      "GET",
      `/api/v3/withdrawals?origin_ids=${encodeURIComponent(originId)}`,
    );
  }
}
