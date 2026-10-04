"use client";

import { useState } from "react";
import { Landmark } from "lucide-react";
import { api } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, Field, Input, Notice, Panel, cx } from "./ui";
import { ars, parseInputMoney, plain } from "@/lib/format";
import { classifyDestination, maskDestination } from "@/lib/validation";

type Account = { id: string; label: string; masked: string };

/** Saque dos pesos da Bitso para uma conta bancária argentina (CBU, CVU ou alias). */
export function Payout({ operationId, suggested, accounts }: { operationId?: string; suggested: string; accounts: Account[] }) {
  const [amountText, setAmountText] = useState(plain(suggested));
  const [choice, setChoice] = useState<string>(accounts[0]?.id ?? "nova");
  const [destination, setDestination] = useState("");
  const [saveAs, setSaveAs] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const amount = parseInputMoney(amountText);
  const typed = choice === "nova" ? classifyDestination(destination) : null;
  const destError = choice === "nova" && destination.length > 5 && !typed ? "CBU/CVU com 22 números válidos, ou alias de 6 a 20 caracteres." : null;
  const ready = !!amount && (choice !== "nova" || !!typed);
  const destLabel =
    choice === "nova" ? (typed ? maskDestination(typed.kind, typed.value) : "") : accounts.find((a) => a.id === choice)?.masked ?? "";

  async function submit(code: string) {
    const r = await api<{ destination: string }>("/api/payouts", {
      body: {
        amount,
        operationId,
        totp: code,
        ...(choice === "nova" ? { destination: typed?.value, saveAs: saveAs.trim() || undefined } : { bankAccountId: choice }),
      },
    });
    setConfirming(false);
    setSent(`Saque de ${ars(amount)} solicitado para ${r.destination}. A Bitso processa na hora e o banco pode levar até 24 horas úteis.`);
  }

  if (sent) {
    return (
      <Panel className="space-y-3">
        <h2 className="font-titulo text-xl font-semibold">Saque solicitado</h2>
        <Notice tone="ok">{sent}</Notice>
      </Panel>
    );
  }

  return (
    <Panel className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-peso-claro text-peso">
          <Landmark className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-titulo text-xl font-semibold">Sacar para conta bancária</h2>
          <p className="text-sm text-suave">Opcional. Os pesos também podem ficar na Bitso.</p>
        </div>
      </div>

      <Field label="Valor em pesos">
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ""))} />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-semibold">Destino</legend>
        {accounts.map((a) => (
          <label
            key={a.id}
            className={cx(
              "flex cursor-pointer items-center justify-between gap-3 rounded-campo border px-4 py-3",
              choice === a.id ? "border-peso bg-peso-claro/50" : "border-linha",
            )}
          >
            <span className="flex items-center gap-3">
              <input type="radio" name="destino" value={a.id} checked={choice === a.id} onChange={() => setChoice(a.id)} className="accent-[#2F6FC9]" />
              <span className="font-medium">{a.label}</span>
            </span>
            <span className="text-sm tabular-nums text-suave">{a.masked}</span>
          </label>
        ))}
        <label
          className={cx(
            "flex cursor-pointer items-center gap-3 rounded-campo border px-4 py-3",
            choice === "nova" ? "border-peso bg-peso-claro/50" : "border-linha",
          )}
        >
          <input type="radio" name="destino" value="nova" checked={choice === "nova"} onChange={() => setChoice("nova")} className="accent-[#2F6FC9]" />
          <span className="font-medium">Outra conta</span>
        </label>
      </fieldset>

      {choice === "nova" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CBU, CVU ou alias" error={destError}>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Salvar como (opcional)" hint="Ex.: Banco Nación da mamãe">
            <Input value={saveAs} onChange={(e) => setSaveAs(e.target.value)} maxLength={40} />
          </Field>
        </div>
      )}

      <Button variant="secundario" className="w-full" disabled={!ready} onClick={() => setConfirming(true)}>
        {amount ? `Sacar ${ars(amount)}` : "Sacar"}
      </Button>

      <ConfirmDialog open={confirming} title="Confirmar saque" confirmLabel="Sacar agora" onCancel={() => setConfirming(false)} onConfirm={submit}>
        <p className="text-[15px]">
          Enviar <strong>{ars(amount)}</strong> da Bitso para <strong>{destLabel}</strong>. Confira o destino: transferências bancárias não podem ser desfeitas.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}
