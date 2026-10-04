import "server-only";
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "precisa ter 32 bytes em base64"),
  APP_URL: z.string().url(),
  MB_EGRESS_PROXY_URL: z.string().url().optional().or(z.literal("")),
  // Certificado (PEM em base64) do proxy, fixado: só confiamos NESTE certificado.
  MB_EGRESS_PROXY_CA: z.string().optional().or(z.literal("")),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Não imprime valores, só os nomes das variáveis com problema.
    const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variáveis de ambiente inválidas: ${campos}`);
  }
  cached = parsed.data;
  return cached;
}
