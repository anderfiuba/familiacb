import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/** Cliente com a sessão do usuário (respeita RLS). */
export async function supabaseUser() {
  const cookieStore = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, httpOnly: true, secure: true, sameSite: "lax" }),
          );
        } catch {
          // Chamado a partir de um Server Component: o middleware renova a sessão.
        }
      },
    },
  });
}

let admin: ReturnType<typeof createClient> | null = null;

/** Cliente com service role. SÓ no servidor, SEMPRE filtrando por user_id já autenticado. */
export function supabaseAdmin() {
  if (!admin) {
    const e = env();
    admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
