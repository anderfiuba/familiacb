"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** fetch para a nossa API: same-origin, JSON, erros com mensagem pronta para mostrar. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && json?.error?.code === "MFA_PENDENTE") window.location.href = "/verificar";
    else if (res.status === 401 && json?.error?.code === "NAO_AUTENTICADO") window.location.href = "/entrar";
    throw new ApiError(res.status, json?.error?.code ?? "ERRO", json?.error?.message ?? "Não foi possível concluir. Tente de novo.");
  }
  return json as T;
}
