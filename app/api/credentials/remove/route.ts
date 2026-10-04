import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, audit, handler, parseJson, requireFreshTotp, requireSession } from "@/lib/server/guard";
import { deleteCredential } from "@/lib/server/credentials";
import { forgetFees } from "@/lib/server/quoting";
import { totpCode } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const s = await requireSession();
  const b = await parseJson(req, z.object({ provider: z.enum(["mercadobitcoin", "bitso"]), totp: totpCode }));
  await requireFreshTotp(s.userId, b.totp);
  await deleteCredential(s.userId, b.provider);
  forgetFees(s.userId);
  await audit(s.userId, "credencial_removida", { provider: b.provider });
  return NextResponse.json({ ok: true });
});
