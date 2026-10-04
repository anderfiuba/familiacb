"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { api } from "./api";
import { ConfirmDialog } from "./confirm-dialog";
import { Button, Field, Input, Notice, Panel } from "./ui";
import { brl, dateTime } from "@/lib/format";
import { classifyDestination } from "@/lib/validation";

type Creds = {
  mercadobitcoin: { configured: boolean; hint?: string; updatedAt?: string };
  bitso: { configured: boolean; hint?: string; updatedAt?: string };
};

type Pending = { title: string; label: string; body?: ReactNode; run: (code: string) => Promise<void> } | null;

export function Settings(props: {
  creds: Creds;
  destination: { address: string; holder: string };
  accounts: { id: string; label: string; masked: string }[];
  limits: { perOp: number; perDay: number };
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "alerta"; text: string } | null>(null);

  const ask = (p: NonNullable<Pending>) => setPending(p);
  const finish = (text: string, tone: "ok" | "alerta" = "ok") => {
    setPending(null);
    setFlash({ tone, text });
    router.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="font-titulo text-[30px] font-semibold leading-tight">Configurações</h1>
        <p className="text-suave">Toda alteração aqui pede o código do autenticador.</p>
      </div>
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}

      <section className="space-y-4">
        <h2 className="font-titulo text-xl font-semibold">Chaves de API</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <KeyCard
            name="Mercado Bitcoin"
            provider="mercadobitcoin"
            status={props.creds.mercadobitcoin}
            idLabel="Client ID"
            secretLabel="Client Secret"
            help={
              <>
                Crie em Mercado Bitcoin → Configurações → API. A chave precisa de permissão para <b>negociar</b> e para
                <b> saque de cripto</b>. Cadastre o endereço da Bitso como destino confiável e o IP fixo do proxy no
                Saque Automatizado.
              </>
            }
            ask={ask}
            finish={finish}
          />
          <KeyCard
            name="Bitso"
            provider="bitso"
            status={props.creds.bitso}
            idLabel="API Key"
            secretLabel="API Secret"
            help={
              <>
                Crie em Bitso → Perfil → API. Ative <b>ver saldo</b>, <b>negociar</b> e <b>sacar</b>. O familiacb só usa o
                saque para enviar pesos às contas que você cadastrar aqui.
              </>
            }
            ask={ask}
            finish={finish}
          />
        </div>
      </section>

      <DestinationCard initial={props.destination} ask={ask} finish={finish} />
      <AccountsCard accounts={props.accounts} ask={ask} finish={finish} />

      <Panel className="space-y-2">
        <h2 className="font-titulo text-xl font-semibold">Seus limites</h2>
        <p>
          {brl(props.limits.perOp)} por operação e {brl(props.limits.perDay)} por dia.
        </p>
        <p className="text-sm text-suave">Para alterar, fale com o administrador da família.</p>
      </Panel>

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

type AskFns = { ask: (p: NonNullable<Pending>) => void; finish: (text: string, tone?: "ok" | "alerta") => void };

function KeyCard({
  name,
  provider,
  status,
  idLabel,
  secretLabel,
  help,
  ask,
  finish,
}: AskFns & {
  name: string;
  provider: "mercadobitcoin" | "bitso";
  status: { configured: boolean; hint?: string; updatedAt?: string };
  idLabel: string;
  secretLabel: string;
  help: ReactNode;
}) {
  const [editing, setEditing] = useState(!status.configured);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");

  return (
    <Panel className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-titulo text-lg font-semibold">
          <KeyRound className="h-5 w-5 text-suave" aria-hidden /> {name}
        </h3>
        {status.configured && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-real-claro px-3 py-1 text-sm font-semibold text-[#16683f]">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Conectada
          </span>
        )}
      </div>
      {status.configured && !editing ? (
        <>
          <p className="text-[15px]">
            Chave {status.hint}, validada em {status.updatedAt ? dateTime(status.updatedAt) : "—"}. O segredo fica cifrado e
            nunca volta para o navegador.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secundario" onClick={() => setEditing(true)}>
              Trocar chave
            </Button>
            <Button
              variant="perigo"
              onClick={() =>
                ask({
                  title: `Remover chave da ${name}`,
                  label: "Remover",
                  body: <p className="text-[15px] text-suave">Sem esta chave você só poderá simular conversões.</p>,
                  run: async (totp) => {
                    await api("/api/credentials/remove", { body: { provider, totp } });
                    finish(`Chave da ${name} removida.`);
                  },
                })
              }
            >
              Remover
            </Button>
          </div>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask({
              title: `Salvar chave da ${name}`,
              label: "Validar e salvar",
              body: <p className="text-[15px] text-suave">Vamos testar a chave na {name} antes de salvar.</p>,
              run: async (totp) => {
                await api("/api/credentials", { body: { provider, keyId: keyId.trim(), secret: secret.trim(), totp } });
                setSecret("");
                setKeyId("");
                setEditing(false);
                finish(`Chave da ${name} validada e salva.`);
              },
            });
          }}
        >
          <p className="text-sm leading-relaxed text-suave">{help}</p>
          <Field label={idLabel}>
            <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} required minLength={8} />
          </Field>
          <Field label={secretLabel}>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              required
              minLength={8}
            />
          </Field>
          <div className="flex gap-3">
            <Button type="submit" disabled={keyId.length < 8 || secret.length < 8}>
              Validar e salvar
            </Button>
            {status.configured && (
              <Button type="button" variant="fantasma" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      )}
    </Panel>
  );
}

function DestinationCard({ initial, ask, finish }: AskFns & { initial: { address: string; holder: string } }) {
  const [address, setAddress] = useState(initial.address);
  const [holder, setHolder] = useState(initial.holder);
  const validAddress = /^0x[a-fA-F0-9]{40}$/.test(address.trim());
  const changed = address.trim() !== initial.address || holder.trim() !== initial.holder;

  return (
    <Panel className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-titulo text-xl font-semibold">Destino do USDT na Bitso</h2>
        <p className="text-sm text-suave">
          Endereço de depósito de USDT na rede <b>Polygon</b> da sua conta Bitso. Ele precisa estar cadastrado como destino
          confiável no Mercado Bitcoin. O nome do titular vai na declaração de Travel Rule exigida pelo MB.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <Field label="Endereço USDT (Polygon)" error={address && !validAddress ? "Começa com 0x e tem 42 caracteres." : null}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x…" />
        </Field>
        <Field label="Nome completo do titular">
          <Input value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" />
        </Field>
      </div>
      <Button
        disabled={!validAddress || holder.trim().length < 5 || !changed}
        onClick={() =>
          ask({
            title: "Alterar destino do USDT",
            label: "Salvar destino",
            body: (
              <p className="break-all text-[15px]">
                Todo USDT das próximas conversões vai para <b>{address.trim()}</b>. Confira cada caractere com o app da Bitso.
              </p>
            ),
            run: async (totp) => {
              const r = await api<{ whitelisted: boolean | null }>("/api/settings", {
                body: { bitso_usdt_address: address.trim(), travel_rule_name: holder.trim(), totp },
              });
              if (r.whitelisted === false) {
                finish("Destino salvo, mas ele NÃO aparece como confiável no Mercado Bitcoin. Cadastre-o lá antes de converter.", "alerta");
              } else if (r.whitelisted === null) {
                finish("Destino salvo. Não foi possível conferir a lista de confiáveis do MB (o IP fixo está configurado?).", "alerta");
              } else {
                finish("Destino salvo e confirmado na lista de confiáveis do Mercado Bitcoin.");
              }
            },
          })
        }
      >
        Salvar destino
      </Button>
    </Panel>
  );
}

function AccountsCard({ accounts, ask, finish }: AskFns & { accounts: { id: string; label: string; masked: string }[] }) {
  const [label, setLabel] = useState("");
  const [dest, setDest] = useState("");
  const parsed = classifyDestination(dest);

  return (
    <Panel className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-titulo text-xl font-semibold">Contas bancárias na Argentina</h2>
        <p className="text-sm text-suave">Para sacar os pesos com um toque depois da conversão.</p>
      </div>
      {accounts.length > 0 ? (
        <ul className="divide-y divide-linha rounded-campo border border-linha">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{a.label}</span>
                <span className="ml-3 text-sm tabular-nums text-suave">{a.masked}</span>
              </span>
              <button
                className="rounded-full p-2 text-suave hover:bg-alerta-claro hover:text-alerta"
                aria-label={`Remover ${a.label}`}
                onClick={() =>
                  ask({
                    title: "Remover conta",
                    label: "Remover",
                    body: <p className="text-[15px]">Remover “{a.label}” ({a.masked})?</p>,
                    run: async (totp) => {
                      await api("/api/bank-accounts", { body: { action: "remove", id: a.id, totp } });
                      finish("Conta removida.");
                    },
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-campo border border-dashed border-linha px-4 py-6 text-center text-sm text-suave">
          Nenhuma conta salva. Adicione a primeira abaixo.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[2fr_3fr_auto] md:items-end">
        <Field label="Nome da conta">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Ex.: Galicia do papai" />
        </Field>
        <Field label="CBU, CVU ou alias" error={dest.length > 5 && !parsed ? "Confira os números ou o alias." : null}>
          <Input value={dest} onChange={(e) => setDest(e.target.value)} spellCheck={false} autoComplete="off" />
        </Field>
        <Button
          variant="secundario"
          disabled={!label.trim() || !parsed}
          onClick={() =>
            ask({
              title: "Adicionar conta",
              label: "Adicionar",
              body: (
                <p className="text-[15px]">
                  {label}: {parsed?.kind.toUpperCase()} {parsed?.value}
                </p>
              ),
              run: async (totp) => {
                await api("/api/bank-accounts", { body: { action: "add", label: label.trim(), destination: dest, totp } });
                setLabel("");
                setDest("");
                finish("Conta adicionada.");
              },
            })
          }
        >
          Adicionar
        </Button>
      </div>
    </Panel>
  );
}
