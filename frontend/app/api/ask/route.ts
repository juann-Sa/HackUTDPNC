import { CUSTOMER_ID, callProcedure, select } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

// Ask the AI coach: runs the `ask` procedure (question -> what-if scenario -> forecast -> checked answer),
// then reads back the row it stored in `qa` for the verdict and how the question was understood.
export async function POST(req: Request) {
  const { customer_id, question } = (await req.json()) as { customer_id?: string; question?: string };
  const q = String(question ?? "").trim().slice(0, 300);
  if (!customer_id || !CUSTOMER_ID.test(customer_id)) return Response.json({ error: "Bad customer id" }, { status: 400 });
  if (!q) return Response.json({ error: "Please type a question." }, { status: 400 });
  try {
    const result = await callProcedure("ask", [customer_id, q]);
    const rows = await select(`SELECT * FROM qa WHERE customer_id = '${customer_id}'`);
    const latest = rows.sort((a, b) => Number(b.qa_id) - Number(a.qa_id))[0];
    const fromProcedure = typeof result === "string" ? result : undefined;
    if (latest && String(latest.question) === q)
      return Response.json({ answer: latest.answer, verdict: latest.verdict, interpretation: latest.interpretation, supported: latest.supported, source: latest.source });
    return Response.json({ answer: fromProcedure ?? "No answer came back.", verdict: "", interpretation: "", supported: false, source: "template" });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
