import { CUSTOMER_ID, select } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

// Every table the dashboard reads for one customer, fetched in parallel.
const TABLES = [
  "customer", "account", "external_account", "book_snapshot", "ledger_entry", "statement",
  "pnl_month", "debt_payoff", "debt_plan", "danger_day", "goal", "goal_result", "qa",
  "timeline_360", "timeline_whatif", "coach_action", "forecast_run",
] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CUSTOMER_ID.test(id)) return Response.json({ error: "Bad customer id" }, { status: 400 });
  try {
    const results = await Promise.all(TABLES.map(t => select(`SELECT * FROM ${t} WHERE customer_id = '${id}'`)));
    return Response.json(Object.fromEntries(TABLES.map((t, i) => [t, results[i]])));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
