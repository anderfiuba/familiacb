import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * 1) CSP com nonce por requisição (bloqueia scripts injetados)
 * 2) Renova a sessão do Supabase em cookies HttpOnly (JS do navegador nunca vê tokens)
 * 3) Protege as rotas: /app exige login + 2FA verificado (AAL2)
 */
export async function middleware(req: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let res = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: { headers: requestHeaders } });
        list.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, { ...options, httpOnly: true, secure: !dev, sameSite: "lax" }),
        );
      },
    },
  });

  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const redirect = (to: string) => {
    const r = NextResponse.redirect(new URL(to, req.url));
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    r.headers.set("Content-Security-Policy", csp);
    return r;
  };

  // Sempre valida o usuário no Supabase (getUser), nunca confia só no cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isApi) {
    const needsLogin = path.startsWith("/app") || path === "/definir-senha" || path === "/verificar";
    if (needsLogin && !user) return redirect("/entrar");

    if (user && (path.startsWith("/app") || path === "/entrar" || path === "/")) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== "aal2") return redirect("/verificar");
      if (path === "/entrar" || path === "/") return redirect("/app");
    }
    if (!user && path === "/") return redirect("/entrar");
  }

  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
