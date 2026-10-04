"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primario" | "secundario" | "fantasma" | "perigo";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primario", loading, className, children, disabled, ...rest },
  ref,
) {
  const styles = {
    primario: "bg-tinta text-papel hover:bg-[#22344a] disabled:bg-[#9aa5ae]",
    secundario: "bg-white text-tinta border border-linha hover:border-tinta/40 disabled:text-suave",
    fantasma: "text-tinta hover:bg-tinta/5 disabled:text-suave",
    perigo: "bg-white text-alerta border border-alerta/40 hover:bg-alerta-claro",
  }[variant];
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-campo px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed",
        styles,
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        "w-full rounded-campo border border-linha bg-white px-3 py-2.5 text-[15px] text-tinta placeholder:text-suave/70 focus:border-peso focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-tinta">{label}</span>
      {children}
      {error ? <span className="block text-sm text-alerta">{error}</span> : hint ? <span className="block text-sm text-suave">{hint}</span> : null}
    </label>
  );
}

/** Cartão base. `flush` remove o padding (para conteúdo que encosta nas bordas). */
export function Panel({ className, flush, children }: { className?: string; flush?: boolean; children: ReactNode }) {
  return (
    <section className={cx("overflow-hidden rounded-painel border border-linha bg-white", !flush && "p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "alerta" | "ok"; children: ReactNode }) {
  const t = {
    info: "bg-peso-claro text-[#1d4a86]",
    alerta: "bg-alerta-claro text-alerta",
    ok: "bg-real-claro text-[#16683f]",
  }[tone];
  return <div className={cx("rounded-campo px-4 py-3 text-sm leading-relaxed", t)}>{children}</div>;
}

/** Campo de código 2FA: 6 dígitos, teclado numérico, preenchimento automático do SO. */
export const CodeInput = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; autoFocus?: boolean }>(
  function CodeInput({ value, onChange, autoFocus }, ref) {
    return (
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        autoFocus={autoFocus}
        placeholder="000000"
        aria-label="Código de 6 dígitos do autenticador"
        className="text-center font-titulo text-2xl tracking-[0.4em]"
      />
    );
  },
);
