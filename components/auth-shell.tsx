import type { ReactNode } from "react";

/** Moldura das telas de acesso: a marca à esquerda, o formulário à direita. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-tinta p-12 text-papel lg:flex lg:flex-col lg:justify-between">
        <span className="font-titulo text-2xl font-semibold">familiacb</span>
        <div className="space-y-8">
          <svg viewBox="0 0 420 120" className="w-full max-w-[460px]" aria-hidden>
            <path d="M12 96 C 120 96, 150 24, 260 24 L 408 24" fill="none" stroke="#1F8A5B" strokeWidth="10" strokeLinecap="round" />
            <path d="M260 24 L 408 24" fill="none" stroke="#2F6FC9" strokeWidth="10" strokeLinecap="round" />
            <circle cx="12" cy="96" r="10" fill="#F3F5F2" />
            <circle cx="260" cy="24" r="7" fill="#14202B" stroke="#F3F5F2" strokeWidth="4" />
            <circle cx="408" cy="24" r="10" fill="#F3F5F2" />
          </svg>
          <p className="max-w-sm font-titulo text-[34px] font-semibold leading-[1.1]">
            Do real ao peso, sem atravessar a fronteira.
          </p>
        </div>
        <p className="text-sm text-papel/60">Acesso somente por convite.</p>
      </aside>
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px] space-y-8">
          <div className="space-y-2">
            <span className="font-titulo text-xl font-semibold lg:hidden">familiacb</span>
            <h1 className="font-titulo text-[28px] font-semibold leading-tight">{title}</h1>
            {subtitle && <p className="text-suave">{subtitle}</p>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
