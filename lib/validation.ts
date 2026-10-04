import { z } from "zod";

/** CBU/CVU argentino: 22 dígitos com dois dígitos verificadores. CVU começa com "000". */
export function isValidCbu(v: string) {
  if (!/^\d{22}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const w1 = [7, 1, 3, 9, 7, 1, 3];
  const s1 = w1.reduce((s, w, i) => s + w * d[i]!, 0);
  if ((10 - (s1 % 10)) % 10 !== d[7]) return false;
  const w2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];
  const s2 = w2.reduce((s, w, i) => s + w * d[8 + i]!, 0);
  return (10 - (s2 % 10)) % 10 === d[21];
}

export const isValidAlias = (v: string) => /^[a-zA-Z0-9.-]{6,20}$/.test(v);

export function classifyDestination(raw: string): { kind: "cbu" | "cvu" | "alias"; value: string } | null {
  const v = raw.trim().replace(/\s+/g, "");
  if (/^\d{22}$/.test(v)) {
    if (!isValidCbu(v)) return null;
    return { kind: v.startsWith("000") ? "cvu" : "cbu", value: v };
  }
  if (isValidAlias(v)) return { kind: "alias", value: v.toLowerCase() };
  return null;
}

export function maskDestination(kind: string, value: string) {
  return kind === "alias" ? value : `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export const polygonAddress = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Endereço Polygon inválido (começa com 0x e tem 42 caracteres).");

export const totpCode = z.string().regex(/^\d{6}$/, "Digite os 6 números do autenticador.");

export const money = (max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Valor inválido.")
    .refine((v) => Number(v) > 0 && Number(v) <= max, "Valor fora do permitido.");
