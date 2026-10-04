"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, Field, Input, Notice, Panel, cx } from "./ui";
import { brl } from "@/lib/format";

type User = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "member";
  limit_per_op: number;
  limit_per_day: number;
  disabled: boolean;
  active: boolean;
};

type Pending = { title: string; label: string; body?: ReactNode; run: (code: string) => Promise<void> } | null;

export function Admin({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(() => api<{ users: User[] }>("/api/admin/users").then((r) => setUsers(r.users)), []);
  useEffect(() => {
    load().catch(() => setUsers([]));
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="font-titulo text-[30px] font-semibold leading-tight">Família</h1>
        <p className="text-suave">Só quem você convidar consegue entrar. Cada pessoa usa as próprias chaves.</p>
      </div>
      {flash && <Notice tone="ok">{flash}</Notice>}

      <Panel className="space-y-4">
        <h2 className="font-titulo text-xl font-semibold">Convidar alguém</h2>
        <div className="grid gap-4 md:grid-cols-[2fr_3fr_auto] md:items-end">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Button
            disabled={name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email)}
            onClick={() =>
              setPending({
                title: "Enviar convite",
                label: "Enviar",
                body: (
                  <p className="text-[15px]">
                    {name} receberá em {email} um link para criar a senha e configurar o autenticador.
                  </p>
                ),
                run: async (totp) => {
                  await api("/api/admin/invite", { body: { email: email.trim(), fullName: name.trim(), totp } });
                  setPending(null);
                  setFlash(`Convite enviado para ${email}.`);
                  setEmail("");
                  setName("");
                  load();
                },
              })
            }
          >
            Convidar
          </Button>
        </div>
      </Panel>

      <section className="space-y-3">
        <h2 className="font-titulo text-xl font-semibold">Pessoas</h2>
        {users === null ? (
          <p className="text-suave">Carregando…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {users.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                self={u.id === selfId}
                onSave={(patch) =>
                  setPending({
                    title: `Atualizar ${u.full_name ?? u.email}`,
                    label: "Salvar",
                    body: (
                      <p className="text-[15px]">
                        {patch.disabled ? "Acesso desativado. " : ""}Limites: {brl(patch.limitPerOp)} por operação, {brl(patch.limitPerDay)} por dia.
                      </p>
                    ),
                    run: async (totp) => {
                      await api("/api/admin/users", { body: { userId: u.id, ...patch, totp } });
                      setPending(null);
                      setFlash("Alterações salvas.");
                      load();
                    },
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ""}
        confirmLabel={pending?.label ?? "Confirmar"}
        onCancel={() => setPending(null)}
        onConfirm={async (code) => {
          if (pending) await pending.run(code);
        }}
      >
        {pending?.body}
      </ConfirmDialog>
    </div>
  );
}

function UserCard({
  user,
  self,
  onSave,
}: {
  user: User;
  self: boolean;
  onSave: (p: { limitPerOp: number; limitPerDay: number; disabled: boolean }) => void;
}) {
  const [perOp, setPerOp] = useState(String(user.limit_per_op));
  const [perDay, setPerDay] = useState(String(user.limit_per_day));
  const [disabled, setDisabled] = useState(user.disabled);
  const changed = Number(perOp) !== Number(user.limit_per_op) || Number(perDay) !== Number(user.limit_per_day) || disabled !== user.disabled;

  return (
    <Panel className={cx("space-y-4", user.disabled && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{user.full_name ?? "Sem nome"}{self ? " (você)" : ""}</p>
          <p className="text-sm text-suave">{user.email}</p>
        </div>
        <span
          className={cx(
            "rounded-full px-3 py-1 text-sm font-semibold",
            user.disabled ? "bg-alerta-claro text-alerta" : user.active ? "bg-real-claro text-[#16683f]" : "bg-papel text-suave",
          )}
        >
          {user.disabled ? "Desativado" : user.active ? (user.role === "admin" ? "Administrador" : "Ativo") : "Convite pendente"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Por operação (R$)">
          <Input inputMode="numeric" value={perOp} onChange={(e) => setPerOp(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Por dia (R$)">
          <Input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      {!self && (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} className="h-4 w-4 accent-[#B4430E]" />
          Desativar acesso
        </label>
      )}
      <Button
        variant="secundario"
        disabled={!changed || !Number(perOp) || !Number(perDay)}
        onClick={() => onSave({ limitPerOp: Number(perOp), limitPerDay: Number(perDay), disabled })}
      >
        Salvar
      </Button>
    </Panel>
  );
}
