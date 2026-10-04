"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck, X } from "lucide-react";
import { Button, CodeInput } from "./ui";

/**
 * Diálogo de confirmação com código do autenticador. Usado em toda ação sensível:
 * operar, sacar, salvar chaves, alterar destino.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (code: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCode("");
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return setError("Digite os 6 números do autenticador.");
    setBusy(true);
    setError(null);
    try {
      await onConfirm(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="w-[min(440px,calc(100vw-32px))] rounded-painel border border-linha bg-white p-0 text-tinta shadow-[0_24px_60px_-20px_rgba(20,32,43,.45)] backdrop:bg-tinta/40"
    >
      <form onSubmit={submit} className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-titulo text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full p-1 text-suave hover:bg-tinta/5" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-real" aria-hidden /> Código do autenticador
          </p>
          <CodeInput value={code} onChange={setCode} autoFocus />
          {error && <p className="text-sm text-alerta" role="alert">{error}</p>}
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="secundario" onClick={onCancel} disabled={busy} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={code.length !== 6} className="flex-1">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
