const nf = (min: number, max: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });

const n2 = nf(2, 2);
const n4 = nf(2, 4);

const num = (v: string | number | null | undefined) => {
  const x = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(x) ? (x as number) : 0;
};

export const brl = (v: string | number | null | undefined) => `R$ ${n2.format(num(v))}`;
export const ars = (v: string | number | null | undefined) => `$ ${n2.format(num(v))}`;
export const usdt = (v: string | number | null | undefined) => `${n4.format(num(v))} USDT`;
export const plain = (v: string | number | null | undefined, digits = 2) => nf(digits, digits).format(num(v));
export const pct = (fraction: string | number) => `${nf(2, 2).format(num(fraction) * 100)}%`;

/** "1.234,56" (pt-BR) ou "1234.56" → "1234.56" */
export function parseInputMoney(raw: string): string | null {
  const t = raw.replace(/[^\d.,]/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const v = Number(normalized);
  return v > 0 ? v.toFixed(2) : null;
}

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
