import { CUSTOMER_ID, callProcedure } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

// The coach's plain-language explanation of the car-loan options (narrate_car: number-checked, with fallback).
export async function POST(req: Request) {
  const { customer_id } = (await req.json()) as { customer_id?: string };
  if (!customer_id || !CUSTOMER_ID.test(customer_id)) return Response.json({ error: "Bad customer id" }, { status: 400 });
  try {
    const text = await callProcedure("narrate_car", [customer_id]);
    return Response.json({ text: typeof text === "string" ? text : String(text ?? "") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
