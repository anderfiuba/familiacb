"use client";

import { Check, AlertTriangle } from "lucide-react";
import { STATIONS } from "@/lib/steps";
import { cx } from "./ui";

/** Posição (0..1) onde cada estação começa no trajeto. A última posição é o destino. */
export const STATION_AT = [0, 0.25, 0.5, 0.75, 1] as const;

const GRADIENT = "linear-gradient(90deg, #1F8A5B 0%, #1F8A5B 30%, #2A7E9A 55%, #2F6FC9 100%)";
const GRADIENT_V = "linear-gradient(180deg, #1F8A5B 0%, #1F8A5B 30%, #2A7E9A 55%, #2F6FC9 100%)";

type StationState = "feita" | "atual" | "pendente" | "falhou";

function stateOf(i: number, active: number, failed: number | null, done: boolean): StationState {
  if (failed !== null && i === failed) return "falhou";
  if (done || i < active) return "feita";
  if (i === active) return "atual";
  return "pendente";
}

function Node({ state, size = "md" }: { state: StationState; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-9 w-9" : "h-7 w-7";
  if (state === "feita")
    return (
      <span className={cx(dim, "grid place-items-center rounded-full bg-tinta text-papel")}>
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      </span>
    );
  if (state === "falhou")
    return (
      <span className={cx(dim, "grid place-items-center rounded-full bg-alerta text-white")}>
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
    );
  if (state === "atual")
    return <span className={cx(dim, "block rounded-full border-[5px] border-peso bg-white animate-pulso")} aria-hidden />;
  return <span className={cx(dim, "block rounded-full border-[3px] border-linha bg-white")} aria-hidden />;
}

/**
 * O trajeto da conversão: uma linha que sai do verde (real) e chega ao azul (peso).
 * A parte preenchida É a barra de progresso; a moeda avança junto.
 */
export function RouteProgress({
  progress,
  active,
  failed,
  done,
  arrivalLabel,
}: {
  progress: number;
  active: number;
  failed: number | null;
  done: boolean;
  arrivalLabel: string;
}) {
  const p = Math.max(0.02, Math.min(1, progress));
  const labels = [...STATIONS.map((s) => ({ title: s.title, place: s.place })), { title: "Pesos na conta", place: arrivalLabel }];

  return (
    <div>
      {/* Horizontal (tablet e desktop) */}
      <div className="hidden sm:block">
        <div className="relative mx-[18px] h-[10px] rounded-full bg-linha">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-out"
            style={{ width: `${p * 100}%`, backgroundImage: GRADIENT, backgroundSize: `${100 / p}% 100%` }}
          />
          {!done && failed === null && (
            <span
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-peso shadow-[0_4px_14px_rgba(47,111,201,.5)] transition-[left] duration-1000 ease-out"
              style={{ left: `${p * 100}%` }}
              aria-hidden
            />
          )}
          {STATION_AT.map((at, i) => (
            <span key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at * 100}%` }}>
              <Node state={i === 4 ? (done ? "feita" : "pendente") : stateOf(i, active, failed, done)} />
            </span>
          ))}
        </div>
        <ol className="relative mt-5 h-14">
          {labels.map((l, i) => (
            <li
              key={l.title}
              className={cx(
                "absolute w-28 text-sm leading-snug lg:w-36",
                i === 0 ? "left-0 text-left" : i === 4 ? "right-0 text-right" : "-translate-x-1/2 text-center",
              )}
              style={i === 0 || i === 4 ? undefined : { left: `calc(18px + (100% - 36px) * ${STATION_AT[i]})` }}
            >
              <span className={cx("block font-semibold", failed !== null && i === failed ? "text-alerta" : i === active && !done ? "text-peso" : "text-tinta")}>{l.title}</span>
              <span className="block text-suave">{l.place}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Vertical (celular) */}
      <ol className="relative space-y-6 pl-12 sm:hidden">
        <span className="absolute bottom-3 left-[13px] top-3 w-[6px] rounded-full bg-linha" aria-hidden />
        <span
          className="absolute left-[13px] top-3 w-[6px] rounded-full transition-[height] duration-1000 ease-out"
          style={{ height: `calc((100% - 24px) * ${p})`, backgroundImage: GRADIENT_V, backgroundSize: `100% ${100 / p}%` }}
          aria-hidden
        />
        {labels.map((l, i) => (
          <li key={l.title} className="relative">
            <span className="absolute -left-12 top-0">
              <Node state={i === 4 ? (done ? "feita" : "pendente") : stateOf(i, active, failed, done)} />
            </span>
            <span className={cx("block font-semibold leading-7", failed !== null && i === failed ? "text-alerta" : i === active && !done ? "text-peso" : "text-tinta")}>{l.title}</span>
            <span className="block text-sm text-suave">{l.place}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Versão estática do trajeto, usada no conversor para explicar cada taxa. */
export function RouteBreakdown({
  rows,
}: {
  rows: { kind: "valor" | "passo"; title: string; value?: string; note?: string; tone?: "real" | "peso" | "neutro" }[];
}) {
  return (
    <ol className="relative">
      <span
        className="absolute bottom-4 left-[11px] top-4 w-1 rounded-full"
        style={{ backgroundImage: GRADIENT_V }}
        aria-hidden
      />
      {rows.map((r, i) => (
        <li key={i} className={cx("relative flex items-start justify-between gap-4 pl-10", r.kind === "valor" ? "py-3" : "py-2")}>
          {r.kind === "valor" ? (
            <span
              className={cx(
                "absolute left-0 top-3.5 h-[26px] w-[26px] rounded-full border-[5px] bg-white",
                r.tone === "peso" ? "border-peso" : r.tone === "real" ? "border-real" : "border-[#2A7E9A]",
              )}
              aria-hidden
            />
          ) : (
            <span className="absolute left-[7px] top-[14px] h-3 w-3 rounded-full bg-white ring-2 ring-linha" aria-hidden />
          )}
          <span className="min-w-0">
            <span className={cx("block", r.kind === "valor" ? "font-semibold" : "text-sm text-suave")}>{r.title}</span>
            {r.note && <span className="block text-sm text-suave">{r.note}</span>}
          </span>
          {r.value && (
            <span className={cx("shrink-0 text-right", r.kind === "valor" ? "font-titulo text-lg font-semibold" : "text-sm text-suave")}>
              {r.value}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
