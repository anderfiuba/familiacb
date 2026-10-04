import { NextResponse } from "next/server";
import { assertSameOrigin, handler } from "@/lib/server/guard";
import { supabaseUser } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const sb = await supabaseUser();
  await sb.auth.signOut({ scope: "local" });
  return NextResponse.json({ next: "/entrar" });
});
