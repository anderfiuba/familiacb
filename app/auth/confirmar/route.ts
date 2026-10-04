import { NextResponse, type NextRequest } from "next/server";
import { supabaseUser } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/**
 * Destino do link do e-mail de convite/recuperação.
 * Template do Supabase: {{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const allowed = ["invite", "recovery"] as const;

  if (tokenHash && allowed.includes(type as (typeof allowed)[number])) {
    const sb = await supabaseUser();
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type as "invite" | "recovery" });
    if (!error) return NextResponse.redirect(new URL("/definir-senha", url.origin));
  }
  return NextResponse.redirect(new URL("/entrar?erro=link", url.origin));
}
