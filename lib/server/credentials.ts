import "server-only";
import { supabaseAdmin } from "./supabase";
import { open, seal, type Sealed } from "./crypto";
import { MercadoBitcoin, type MbCredentials } from "./exchanges/mercadobitcoin";
import { Bitso, type BitsoCredentials } from "./exchanges/bitso";
import { HttpError } from "./guard";

type Provider = "mercadobitcoin" | "bitso";
type Row = Sealed & { provider: Provider; key_hint: string; validated_at: string | null; updated_at: string };

export type CredentialStatus = {
  mercadobitcoin: { configured: boolean; hint?: string; updatedAt?: string };
  bitso: { configured: boolean; hint?: string; updatedAt?: string };
};

export type UserSettings = {
  mb_account_id: string | null;
  bitso_usdt_address: string | null;
  travel_rule_name: string | null;
};

export async function credentialStatus(userId: string): Promise<CredentialStatus> {
  const { data } = await supabaseAdmin()
    .from("exchange_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", userId);
  const rows = (data ?? []) as Pick<Row, "provider" | "key_hint" | "updated_at">[];
  const get = (p: Provider) => {
    const r = rows.find((x) => x.provider === p);
    return r ? { configured: true, hint: r.key_hint, updatedAt: r.updated_at } : { configured: false };
  };
  return { mercadobitcoin: get("mercadobitcoin"), bitso: get("bitso") };
}

export async function saveCredential(userId: string, provider: Provider, secret: object, keyId: string) {
  const sealed = seal(secret, userId, provider);
  const { error } = await supabaseAdmin()
    .from("exchange_credentials")
    .upsert(
      {
        user_id: userId,
        provider,
        key_hint: `…${keyId.slice(-4)}`,
        ...sealed,
        validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,provider" },
    );
  if (error) throw new HttpError(500, "ERRO_SALVAR", "Não foi possível salvar a chave.");
}

export async function deleteCredential(userId: string, provider: Provider) {
  await supabaseAdmin().from("exchange_credentials").delete().eq("user_id", userId).eq("provider", provider);
}

async function load<T>(userId: string, provider: Provider): Promise<T | null> {
  const { data } = await supabaseAdmin()
    .from("exchange_credentials")
    .select("ciphertext, iv, auth_tag, key_version")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  return open<T>(data as Sealed, userId, provider);
}

export async function getSettings(userId: string): Promise<UserSettings> {
  const { data } = await supabaseAdmin()
    .from("user_settings")
    .select("mb_account_id, bitso_usdt_address, travel_rule_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as UserSettings | null) ?? { mb_account_id: null, bitso_usdt_address: null, travel_rule_name: null };
}

export async function updateSettings(userId: string, patch: Partial<UserSettings>) {
  await supabaseAdmin()
    .from("user_settings")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() } as never, { onConflict: "user_id" });
}

/** Clientes autenticados das duas exchanges, ou erro claro se faltar algo. */
export async function clientsFor(userId: string) {
  const [mb, bitso, settings] = await Promise.all([
    load<MbCredentials>(userId, "mercadobitcoin"),
    load<BitsoCredentials>(userId, "bitso"),
    getSettings(userId),
  ]);
  if (!mb || !bitso) {
    throw new HttpError(409, "CHAVES_PENDENTES", "Configure as chaves do Mercado Bitcoin e da Bitso para operar.");
  }
  return { mb: new MercadoBitcoin(mb, settings.mb_account_id), bitso: new Bitso(bitso), settings };
}

export async function mbClientFor(userId: string) {
  const [mb, settings] = await Promise.all([load<MbCredentials>(userId, "mercadobitcoin"), getSettings(userId)]);
  return mb ? new MercadoBitcoin(mb, settings.mb_account_id) : null;
}

export async function bitsoClientFor(userId: string) {
  const b = await load<BitsoCredentials>(userId, "bitso");
  return b ? new Bitso(b) : null;
}
