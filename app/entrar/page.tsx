"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Input, Notice } from "@/components/ui";
import { api } from "@/components/api";

function Form() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("erro") === "link" ? "Este link de convite expirou ou já foi usado. Peça um novo." : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ next: string }>("/api/auth/login", { body: { email, password } });
      window.location.href = r.next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Notice tone="alerta">{error}</Notice>}
      <Field label="E-mail">
        <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Entrar
      </Button>
    </form>
  );
}

export default function EntrarPage() {
  return (
    <AuthShell title="Entrar" subtitle="Depois da senha, vamos pedir o código do seu autenticador.">
      <Suspense>
        <Form />
      </Suspense>
    </AuthShell>
  );
}
