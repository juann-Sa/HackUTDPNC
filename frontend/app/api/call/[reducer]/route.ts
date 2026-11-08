import { REDUCERS, callReducer } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ reducer: string }> }) {
  const { reducer } = await params;
  if (!REDUCERS[reducer]) return Response.json({ error: "Not allowed" }, { status: 403 });
  try {
    await callReducer(reducer, (await req.json()) as Record<string, unknown>);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
