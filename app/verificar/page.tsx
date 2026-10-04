"use client";

import { useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button, CodeInput, Notice } from "@/components/ui";
import { api } from "@/components/api";

type Enroll = { qr: string; secret: string };

export default function VerificarPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // evita gerar dois QR codes (StrictMode)
    started.current = true;
    api<{ configured: boolean }>("/api/auth/mfa")
      .then(async (r) => {
        setConfigured(r.configured);
        if (!r.configured) setEnroll(await api<Enroll>("/api/auth/mfa", { body: { action: "enroll" } }));
      })
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ next: string }>("/api/auth/mfa", { body: { action: "verify", code } });
      window.location.href = r.next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido.");
      setCode("");
      setBusy(false);
    }
  }

  const title = configured === false ? "Configure o autenticador" : "Código do autenticador";
  const subtitle =
    configured === false
      ? "Escaneie o QR code com Google Authenticator, Authy ou 1Password e digite o código gerado."
      : "Abra seu app autenticador e digite o código de 6 números.";

  return (
    <AuthShell title={title} subtitle={configured === null ? undefined : subtitle}>
      <form onSubmit={submit} className="space-y-5">
        {error && <Notice tone="alerta">{error}</Notice>}
        {enroll && (
          <div className="space-y-3 rounded-painel border border-linha bg-white p-5 text-center">
            {/* QR gerado pelo Supabase (data URL SVG) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="QR code para o app autenticador" className="mx-auto h-48 w-48" />
            {showSecret ? (
              <p className="break-all font-titulo text-sm tracking-wider text-suave">{enroll.secret}</p>
            ) : (
              <button type="button" onClick={() => setShowSecret(true)} className="text-sm font-semibold text-peso underline-offset-4 hover:underline">
                Não consigo escanear
              </button>
            )}
          </div>
        )}
        {configured !== null && (
          <>
            <CodeInput value={code} onChange={setCode} autoFocus />
            <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">
              {configured ? "Confirmar" : "Ativar autenticador"}
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
