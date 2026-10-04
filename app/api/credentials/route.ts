import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, HttpError, parseJson, rateLimit, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { saveCredential, updateSettings, getSettings } from "@/lib/server/credentials";
import { MercadoBitcoin } from "@/lib/server/exchanges/mercadobitcoin";
import { Bitso } from "@/lib/server/exchanges/bitso";
import { ExchangeError } from "@/lib/server/exchanges/http";
import { forgetFees } from "@/lib/server/quoting";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

const body = z.object({
  provider: z.enum(["mercadobitcoin", "bitso"]),
  keyId: z.string().trim().min(8).max(200),
  secret: z.string().trim().min(8).max(500),
  totp: totpCode,
});

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  await rateLimit(`cred:${s.userId}`, 10, 600);
  const b = await parseJson(req, body);
  await requireFreshTotp(s.userId, b.totp);

  // Valida a chave falando com a exchange ANTES de salvar.
  try {
    if (b.provider === "mercadobitcoin") {
      const mb = new MercadoBitcoin({ clientId: b.keyId, clientSecret: b.secret });
      const accountId = await mb.getAccountId();
      await mb.balances();
      await saveCredential(s.userId, "mercadobitcoin", { clientId: b.keyId, clientSecret: b.secret }, b.keyId);
      await updateSettings(s.userId, { mb_account_id: accountId });
    } else {
      const bitso = new Bitso({ apiKey: b.keyId, apiSecret: b.secret });
      await bitso.balances();
      await saveCredential(s.userId, "bitso", { apiKey: b.keyId, apiSecret: b.secret }, b.keyId);
      const settings = await getSettings(s.userId);
      if (!settings.bitso_usdt_address) {
        const addr = await bitso.usdtPolygonAddress();
        if (addr) await updateSettings(s.userId, { bitso_usdt_address: addr });
      }
    }
  } catch (e) {
    await audit(s.userId, "credencial_recusada", { provider: b.provider });
    if (e instanceof ExchangeError) {
      throw new HttpError(400, "CHAVE_RECUSADA", `A ${b.provider === "bitso" ? "Bitso" : "Mercado Bitcoin"} recusou a chave: ${e.message}`);
    }
    throw e;
  }

  forgetFees(s.userId);
  await audit(s.userId, "credencial_salva", { provider: b.provider });
  return NextResponse.json({ ok: true });
});
