import Link from "next/link";
import { pageSession } from "@/lib/server/page-session";
import { NavLinks, LogoutButton } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await pageSession();
  const first = (s.profile.full_name ?? s.email).split(" ")[0];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-linha bg-papel/90 backdrop-blur supports-[backdrop-filter]:bg-papel/75">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/app" className="font-titulo text-xl font-semibold">
            familiacb
          </Link>
          <NavLinks admin={s.profile.role === "admin"} />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-suave sm:inline">Olá, {first}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
