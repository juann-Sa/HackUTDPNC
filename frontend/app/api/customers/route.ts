import { select } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await select("SELECT customer_id FROM customer");
    return Response.json(rows.map(r => String(r.customer_id)).sort());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
