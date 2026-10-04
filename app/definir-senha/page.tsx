"use client";

import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api } from "@/components/api";

export default function DefinirSenhaPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strongEnough = password.length >= 12 && /[a-zA-Z]/.test(password) && /\d/.test(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("As senhas não são iguais.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ next: string }>("/api/auth/password", { body: { password } });
      window.location.href = r.next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a senha.");
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Crie sua senha" subtitle="Você foi convidado para o familiacb. Depois da senha, vamos configurar o autenticador.">
      <form onSubmit={submit} className="space-y-5">
        {error && <Notice tone="alerta">{error}</Notice>}
        <Field label="Nova senha" hint="Pelo menos 12 caracteres, com letras e números.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Repita a senha">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <Button type="submit" loading={busy} disabled={!strongEnough || !confirm} className="w-full">
          Salvar senha
        </Button>
      </form>
    </AuthShell>
  );
}
