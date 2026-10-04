"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { api } from "./api";
import { cx } from "./ui";

export function NavLinks({ admin }: { admin: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/app", label: "Converter" },
    { href: "/app/historico", label: "Histórico" },
    { href: "/app/configuracoes", label: "Configurações" },
    ...(admin ? [{ href: "/app/admin", label: "Família" }] : []),
  ];
  return (
    <nav aria-label="Principal" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
      {links.map((l) => {
        const active = l.href === "/app" ? path === "/app" || path.startsWith("/app/operacao") : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
              active ? "bg-tinta text-papel" : "text-suave hover:bg-tinta/5 hover:text-tinta",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        const r = await api<{ next: string }>("/api/auth/logout", { body: {} }).catch(() => ({ next: "/entrar" }));
        window.location.href = r.next;
      }}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-suave hover:bg-tinta/5 hover:text-tinta"
    >
      <LogOut className="h-4 w-4" aria-hidden /> Sair
    </button>
  );
}
