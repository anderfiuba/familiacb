import "server-only";
import { redirect } from "next/navigation";
import { HttpError, requireSession, type Session } from "./guard";

/** Para Server Components: mesma checagem das APIs, mas redireciona em vez de lançar erro. */
export async function pageSession(opts: { admin?: boolean } = {}): Promise<Session> {
  try {
    return await requireSession(opts);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.code === "MFA_PENDENTE") redirect("/verificar");
      if (e.code === "SEM_PERMISSAO") redirect("/app");
      redirect("/entrar");
    }
    throw e;
  }
}
