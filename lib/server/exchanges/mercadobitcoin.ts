import "server-only";
import { ExchangeError, direct, mbDispatcherFor, request } from "./http";
import type { Level } from "@/lib/quote";

/**
 * Cliente da API v4 do Mercado Bitcoin.
 * Referência: https://api.mercadobitcoin.net/api/v4/docs
 *  - Auth: POST /oauth2/token (client_credentials) → Bearer, válido ~1h
 *  - Saques cripto só para destinos "confiáveis" e a partir do IP cadastrado no Saque Automatizado
 *  - Desde 01/05/2026 todo saque cripto exige bloco travel_rule
 */
const HOST = "https://api.mercadobitcoin.net";
const BASE = `${HOST}/api/v4`;

export type MbCredentials = { clientId: string; clientSecret: string };

type Token = { value: string; expiresAt: number };
const tokenCache = new Map<string, Token>(); // por instância serverless, chave = hash do clientId

function fail(status: number, json: unknown, fallback: string): never {
  const j = json as { code?: string; message?: string } | null;
  throw new ExchangeError("mercadobitcoin", status, j?.code ?? `HTTP_${status}`, j?.message ?? fallback, false);
}

export class MercadoBitcoin {
  private accountId: string | null = null;
  constructor(private creds: MbCredentials, accountId?: string | null) {
    this.accountId = accountId ?? null;
  }

  // ------------------------------------------------------------------ público
  static async orderbook(symbol = "USDT-BRL", limit = 200): Promise<{ asks: Level[]; bids: Level[] }> {
    const { status, json } = await request("mercadobitcoin", `${BASE}/${symbol}/orderbook?limit=${limit}`, {
      dispatcher: direct(),
    });
    if (status !== 200) fail(status, json, "Falha ao ler o livro de ofertas.");
    const j = json as { asks: [string, string][]; bids: [string, string][] };
    const map = (rows: [string, string][]) => rows.map(([price, amount]) => ({ price: String(price), amount: String(amount) }));
    const asks = map(j.asks).sort((a, b) => Number(a.price) - Number(b.price));
    const bids = map(j.bids).sort((a, b) => Number(b.price) - Number(a.price));
    return { asks, bids };
  }

  static async withdrawFee(asset = "USDT", network = "polygon") {
    const { status, json } = await request(
      "mercadobitcoin",
      `${BASE}/${asset}/fees?network=${encodeURIComponent(network)}`,
      { dispatcher: direct() },
    );
    if (status !== 200) fail(status, json, "Falha ao ler a taxa de saque.");
    const j = json as { withdrawal_fee: string; withdraw_minimum: string; network: string };
    if (j.network !== network) {
      throw new ExchangeError("mercadobitcoin", 200, "REDE_DIVERGENTE", "Rede de saque inesperada.", false);
    }
    return { fee: String(j.withdrawal_fee), minimum: String(j.withdraw_minimum) };
  }

  // ------------------------------------------------------------------ privado
  private async token(): Promise<string> {
    const key = this.creds.clientId;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "global",
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    const { status, json } = await request("mercadobitcoin", `${HOST}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      dispatcher: mbDispatcherFor(),
    });
    if (status === 401 || status === 400) {
      throw new ExchangeError("mercadobitcoin", status, "CREDENCIAIS_INVALIDAS", "Chave do Mercado Bitcoin recusada.", false);
    }
    if (status !== 200) fail(status, json, "Falha na autenticação do Mercado Bitcoin.");
    const j = json as { access_token: string; expires_in: number };
    tokenCache.set(key, { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3000) * 1000 });
    return j.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    const { status, json } = await request("mercadobitcoin", `${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      dispatcher: mbDispatcherFor(),
    });
    if (status === 401) {
      tokenCache.delete(this.creds.clientId);
      throw new ExchangeError("mercadobitcoin", 401, "NAO_AUTORIZADO", "Mercado Bitcoin recusou o acesso.", false);
    }
    if (status === 403) {
      throw new ExchangeError(
        "mercadobitcoin",
        403,
        "SEM_PERMISSAO",
        "Mercado Bitcoin recusou a operação (permissão da chave ou IP não cadastrado).",
        false,
      );
    }
    if (status < 200 || status >= 300) fail(status, json, "O Mercado Bitcoin recusou a solicitação.");
    return json as T;
  }

  async getAccountId(): Promise<string> {
    if (this.accountId) return this.accountId;
    const accounts = await this.call<{ id: string; currency: string }[]>("GET", "/accounts");
    const acc = accounts.find((a) => a.currency === "BRL") ?? accounts[0];
    if (!acc) throw new ExchangeError("mercadobitcoin", 200, "SEM_CONTA", "Nenhuma conta encontrada no Mercado Bitcoin.", false);
    this.accountId = acc.id;
    return acc.id;
  }

  async balances() {
    const id = await this.getAccountId();
    const rows = await this.call<{ symbol: string; available: string; on_hold: string; total: string }[]>(
      "GET",
      `/accounts/${id}/balances`,
    );
    const pick = (s: string) => rows.find((r) => r.symbol.toUpperCase() === s);
    return {
      brl: pick("BRL")?.available ?? "0",
      usdt: pick("USDT")?.available ?? "0",
    };
  }

  async takerFee(symbol = "USDT-BRL"): Promise<string> {
    const id = await this.getAccountId();
    const r = await this.call<{ taker_fee: string }>("GET", `/accounts/${id}/${symbol}/fees`);
    return String(r.taker_fee);
  }

  async placeMarketBuy(costBrl: string, externalId: string): Promise<string> {
    const id = await this.getAccountId();
    const r = await this.call<{ orderId: string }>("POST", `/accounts/${id}/USDT-BRL/orders`, {
      side: "buy",
      type: "market",
      cost: Number(costBrl), // a API espera number neste campo
      externalId,
      async: false,
    });
    return r.orderId;
  }

  async getOrder(orderId: string) {
    const id = await this.getAccountId();
    return this.call<{
      id: string;
      status: "created" | "working" | "cancelled" | "filled";
      filledQty: string;
      avgPrice: number;
      fee: string;
      externalId?: string;
      executions?: { price: number; qty: string; fee_rate: string; executed_at: number }[];
    }>("GET", `/accounts/${id}/USDT-BRL/orders/${encodeURIComponent(orderId)}`);
  }

  /** Recuperação: encontra uma ordem pelo externalId (caso a resposta do POST tenha se perdido). */
  async findOrderByExternalId(externalId: string, sinceUnix: number) {
    const id = await this.getAccountId();
    const list = await this.call<{ id: string; externalId?: string }[]>(
      "GET",
      `/accounts/${id}/USDT-BRL/orders?side=buy&created_at_from=${sinceUnix}`,
    );
    return list.find((o) => o.externalId === externalId) ?? null;
  }

  async withdrawAddresses(): Promise<string[]> {
    const id = await this.getAccountId();
    const rows = await this.call<{ asset: string; address: string }[]>("GET", `/accounts/${id}/wallet/withdraw/addresses`);
    return rows.filter((r) => r.asset?.toUpperCase() === "USDT").map((r) => r.address);
  }

  async withdrawUsdt(p: {
    address: string;
    quantity: string;
    txFee: string;
    description: string;
    holderName: string;
  }) {
    const id = await this.getAccountId();
    return this.call<{ id: number; status: number; quantity: string; net_quantity: string; fee: string; tx?: string }>(
      "POST",
      `/accounts/${id}/wallet/USDT/withdraw`,
      {
        address: p.address,
        quantity: p.quantity,
        tx_fee: p.txFee,
        network: "polygon",
        description: p.description.slice(0, 30),
        travel_rule: {
          custody_type: "INTERNATIONAL_TRANSFER",
          counterparty_name: p.holderName,
          counterparty_country: "AR",
          counterparty_vasp: "Bitso",
          purpose_code: "67995", // Uso pessoal — Minha conta no exterior
          purpose_category: "below_50k_usd",
        },
      },
    );
  }

  async getWithdraw(withdrawId: string) {
    const id = await this.getAccountId();
    return this.call<{ id: number; status: 1 | 2 | 3; quantity: string; net_quantity: string; fee: string; tx?: string }>(
      "GET",
      `/accounts/${id}/wallet/USDT/withdraw/${encodeURIComponent(withdrawId)}`,
    );
  }

  /** Recuperação: encontra um saque pela descrição única da operação. */
  async findWithdrawByDescription(description: string, sinceUnix: number) {
    const id = await this.getAccountId();
    const list = await this.call<{ id: number; description?: string; created_at: string }[]>(
      "GET",
      `/accounts/${id}/wallet/USDT/withdraw?from=${sinceUnix}&page_size=50`,
    );
    return list.find((w) => w.description === description.slice(0, 30)) ?? null;
  }
}
