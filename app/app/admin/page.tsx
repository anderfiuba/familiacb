import { pageSession } from "@/lib/server/page-session";
import { Admin } from "@/components/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const s = await pageSession({ admin: true });
  return <Admin selfId={s.userId} />;
}
