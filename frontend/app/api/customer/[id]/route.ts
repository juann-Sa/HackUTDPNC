import { CUSTOMER_ID, select } from "@/lib/spacetime-server";
import type { PersistedFutureScenario } from "@/lib/live-data";

export const dynamic = "force-dynamic";

// Every table the dashboard reads for one customer, fetched in parallel.
const TABLES = [
  "customer", "account", "external_account", "book_snapshot", "ledger_entry", "statement",
  "pnl_month", "debt_payoff", "debt_plan", "danger_day", "goal", "goal_result", "qa",
  "timeline_360", "timeline_whatif", "future_scenario", "coach_action", "forecast_run", "vehicle", "car_option",
] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CUSTOMER_ID.test(id)) return Response.json({ error: "Bad customer id" }, { status: 400 });
  try {
    const results = await Promise.all(TABLES.map(t => select(`SELECT * FROM ${t} WHERE customer_id = '${id}'`)));
    const data: Record<string, unknown> = Object.fromEntries(TABLES.map((t, i) => [t, results[i]]));
    const scenarioRows = results[TABLES.indexOf("future_scenario")];
    data.future_scenario = scenarioRows.map(row => ({
      scenario_type: String(row.scenario_type),
      scenario: JSON.parse(String(row.scenario_json)),
      forecast: JSON.parse(String(row.forecast_json)),
    })) as PersistedFutureScenario[];
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
