import "server-only";
import { fetch as undiciFetch, ProxyAgent, Agent, type Dispatcher } from "undici";
import { env } from "../env";

/** Erro de exchange. `transient` = vale tentar de novo depois (rede, 5xx, rate limit). */
export class ExchangeError extends Error {
  constructor(
    public exchange: "mercadobitcoin" | "bitso",
    public status: number,
    public code: string,
    message: string,
    public transient: boolean,
  ) {
    super(message);
  }
}

let mbDispatcher: Dispatcher | null = null;
let directDispatcher: Dispatcher | null = null;

/** Dispatcher para o Mercado Bitcoin: via proxy de IP fixo, quando configurado. */
export function mbDispatcherFor(): Dispatcher {
  const e = env();
  if (e.MB_EGRESS_PROXY_URL) {
    if (!mbDispatcher) {
      const ca = e.MB_EGRESS_PROXY_CA ? Buffer.from(e.MB_EGRESS_PROXY_CA, "base64").toString("utf8") : undefined;
      const url = new URL(e.MB_EGRESS_PROXY_URL);
      const token = url.username
        ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`
        : undefined;
      url.username = "";
      url.password = "";
      mbDispatcher = new ProxyAgent({
        uri: url.toString(),
        token,
        // Certificado do proxy fixado: só este é aceito no canal Vercel → proxy.
        proxyTls: ca ? { ca, rejectUnauthorized: true, servername: "familiacb-proxy" } : undefined,
        connectTimeout: 8_000,
      });
    }
    return mbDispatcher;
  }
  return direct();
}

export function direct(): Dispatcher {
  if (!directDispatcher) directDispatcher = new Agent({ connectTimeout: 8_000 });
  return directDispatcher;
}

export async function request(
  exchange: "mercadobitcoin" | "bitso",
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; dispatcher?: Dispatcher; timeoutMs?: number },
): Promise<{ status: number; json: unknown }> {
  let res;
  try {
    res = await undiciFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      dispatcher: init.dispatcher ?? direct(),
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch {
    throw new ExchangeError(exchange, 0, "REDE", "Não foi possível falar com a exchange.", true);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 429 || res.status === 420 || res.status >= 500) {
    throw new ExchangeError(exchange, res.status, "INDISPONIVEL", "Exchange ocupada ou indisponível.", true);
  }
  return { status: res.status, json };
}
