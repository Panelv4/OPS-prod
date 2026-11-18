import { ensureDatabaseReady } from "@/db/bootstrap";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await ensureDatabaseReady();
    return Response.json({ ok: true, service: "opspilot" });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
