import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "./env";
import { supabaseAdmin, supabaseUser } from "./supabase";
import { sha256 } from "./crypto";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Profile = {
  id: string;
  full_name: string | null;
  role: "admin" | "member";
  limit_per_op: number;
  limit_per_day: number;
  disabled: boolean;
};

export type Session = { userId: string; email: string; profile: Profile };

/** IP do cliente (Vercel envia x-forwarded-for confiável) */
export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "desconhecido";
}

/** Bloqueia requisições de outras origens (CSRF) e exige JSON. */
export async function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  const dev = process.env.NODE_ENV !== "production";
  if (!origin || (origin !== allowed && !(dev && origin.startsWith("http://localhost")))) {
    throw new HttpError(403, "ORIGEM_INVALIDA", "Origem da requisição não permitida.");
  }
  if (req.method !== "GET" && req.method !== "DELETE") {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.startsWith("application/json")) {
      throw new HttpError(415, "FORMATO_INVALIDO", "Envie os dados em JSON.");
    }
  }
}

/**
 * Exige usuário logado E com 2FA verificado nesta sessão (AAL2).
 * Usa getUser() (valida o JWT no Supabase), não getSession().
 */
export async function requireSession(opts: { admin?: boolean } = {}): Promise<Session> {
  const sb = await supabaseUser();
  const { data: userData, error } = await sb.auth.getUser();
  if (error || !userData.user) throw new HttpError(401, "NAO_AUTENTICADO", "Entre novamente.");

  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    throw new HttpError(401, "MFA_PENDENTE", "Confirme o código do autenticador.");
  }

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("id, full_name, role, limit_per_op, limit_per_day, disabled")
    .eq("id", userData.user.id)
    .single<Profile>();
  if (!profile || profile.disabled) throw new HttpError(403, "USUARIO_BLOQUEADO", "Acesso desativado.");
  if (opts.admin && profile.role !== "admin") throw new HttpError(403, "SEM_PERMISSAO", "Apenas o administrador.");

  return {
    userId: userData.user.id,
    email: userData.user.email ?? "",
    profile: { ...profile, limit_per_op: Number(profile.limit_per_op), limit_per_day: Number(profile.limit_per_day) },
  };
}

/**
 * Verificação 2FA "fresca": exigida para salvar chaves, operar e sacar.
 * O código é validado no Supabase e marcado como usado (não pode ser reaproveitado).
 */
export async function requireFreshTotp(userId: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "CODIGO_INVALIDO", "Digite os 6 números do autenticador.");
  await rateLimit(`totp:${userId}`, 6, 300);

  const sb = await supabaseUser();
  const { data: factors } = await sb.auth.mfa.listFactors();
  const factor = factors?.totp?.find((f) => f.status === "verified");
  if (!factor) throw new HttpError(400, "MFA_NAO_CONFIGURADO", "Configure o autenticador primeiro.");

  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) throw new HttpError(401, "CODIGO_INCORRETO", "Código do autenticador incorreto ou expirado.");

  // Um código fica "queimado" por 3 minutos (cobre a janela de tolerância do TOTP).
  const admin = supabaseAdmin();
  await admin
    .from("totp_used")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", new Date(Date.now() - 180_000).toISOString());
  const { error: replay } = await admin
    .from("totp_used")
    .insert({ user_id: userId, code_hash: sha256(`${userId}:${code}`) } as never);
  if (replay) throw new HttpError(401, "CODIGO_REUTILIZADO", "Este código já foi usado. Aguarde o próximo.");
}

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const { data, error } = await supabaseAdmin().rpc("check_rate_limit" as never, {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  } as never);
  if (error) throw new HttpError(503, "INDISPONIVEL", "Serviço temporariamente indisponível.");
  if (data === false) throw new HttpError(429, "MUITAS_TENTATIVAS", "Muitas tentativas. Aguarde alguns minutos.");
}

export async function audit(userId: string | null, action: string, meta?: Record<string, unknown>) {
  const h = await headers();
  await supabaseAdmin()
    .from("audit_log")
    .insert({
      user_id: userId,
      action,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 300),
      meta: meta ?? null,
    } as never);
}

export async function parseJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > 10_000) throw new HttpError(413, "MUITO_GRANDE", "Requisição muito grande.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON_INVALIDO", "Dados inválidos.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "DADOS_INVALIDOS", parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  return parsed.data;
}

/** Envolve um handler: converte erros em respostas JSON sem vazar detalhes internos. */
export function handler(fn: (req: Request, ctx: { params: Promise<any> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<any> }) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      console.error("[erro interno]", err instanceof Error ? err.message : "desconhecido");
      return NextResponse.json(
        { error: { code: "ERRO_INTERNO", message: "Algo falhou do nosso lado. Tente de novo." } },
        { status: 500 },
      );
    }
  };
}
