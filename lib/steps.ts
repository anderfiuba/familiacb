/** Etapas mostradas ao usuário e o progresso de cada estado interno. Compartilhado com o navegador. */

export const STATIONS = [
  { key: "compra", title: "Compra de USDT", place: "Mercado Bitcoin", detail: "Seus reais viram USDT" },
  { key: "envio", title: "Envio para a Bitso", place: "Rede Polygon", detail: "O USDT sai do Mercado Bitcoin" },
  { key: "rede", title: "Chegada na Bitso", place: "Bitso Argentina", detail: "Confirmações na rede" },
  { key: "venda", title: "Venda por pesos", place: "Bitso Argentina", detail: "USDT vira pesos" },
] as const;

type Pos = { station: number; base: number; span: number };

const MAP: Record<string, Pos> = {
  created: { station: 0, base: 0.02, span: 0.04 },
  mb_buy_submitting: { station: 0, base: 0.08, span: 0.04 },
  mb_buy_submitted: { station: 0, base: 0.14, span: 0.06 },
  mb_bought: { station: 1, base: 0.26, span: 0.04 },
  mb_withdraw_submitting: { station: 1, base: 0.32, span: 0.04 },
  mb_withdraw_submitted: { station: 1, base: 0.38, span: 0.1 },
  bitso_waiting: { station: 2, base: 0.52, span: 0.21 },
  bitso_sell_submitting: { station: 3, base: 0.77, span: 0.05 },
  bitso_sell_submitted: { station: 3, base: 0.84, span: 0.12 },
  completed: { station: 4, base: 1, span: 0 },
};

/**
 * Progresso 0..1. Nas etapas que dependem de tempo (rede), avança suavemente
 * em direção ao fim da faixa, sem nunca chegar antes do passo real terminar.
 */
export function progressOf(status: string, sinceIso: string | null, now = Date.now()) {
  const p = MAP[status] ?? MAP.created!;
  const elapsed = sinceIso ? Math.max(0, now - new Date(sinceIso).getTime()) : 0;
  const expectedMs = status === "bitso_waiting" ? 6 * 60_000 : 45_000;
  const eased = 1 - Math.exp(-elapsed / expectedMs);
  return { station: p.station, value: Math.min(0.99, p.base + p.span * eased) };
}

export function stationOf(status: string) {
  return (MAP[status] ?? MAP.created!).station;
}

export type PublicOperation = {
  id: string;
  status: string;
  failedAt: string | null;
  failedStation: number | null;
  error: string | null;
  canResume: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  brl: string;
  estimate: {
    arsNet: string;
    rate: string;
    mbAvgPrice: string;
    bitsoAvgPrice: string;
    usdtArrives: string;
    feesInBrl: string;
  };
  mb: { avgPrice: string | null; usdtBought: string | null; feeUsdt: string | null; withdrawFee: string | null; usdtSent: string | null; tx: string | null };
  bitso: { usdtReceived: string | null; usdtSold: string | null; avgPrice: string | null; feeArs: string | null; arsReceived: string | null };
};
