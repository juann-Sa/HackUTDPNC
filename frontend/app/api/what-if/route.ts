import { CUSTOMER_ID, callReducer, select } from "@/lib/spacetime-server";

export const dynamic = "force-dynamic";

const CATEGORIES = ["housing", "utilities", "groceries", "other_spending", "dining", "transport", "shopping"] as const;
type Category = (typeof CATEGORIES)[number];
class InputError extends Error {}

const boundedNumber = (value: unknown, min: number, max: number, name: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new InputError(`Invalid ${name}`);
  return parsed;
};

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    if (!CUSTOMER_ID.test(customerId)) return Response.json({ error: "Bad customer id" }, { status: 400 });

    const rawCategories = body.category_mults;
    if (!rawCategories || typeof rawCategories !== "object" || Array.isArray(rawCategories))
      throw new InputError("Invalid spending adjustments");
    const categoryMults = CATEGORIES.map((category: Category) => ({
      category,
      mult: boundedNumber((rawCategories as Record<string, unknown>)[category], 0, 3, `${category} multiplier`),
    }));
    const purchaseKind = body.purchase_kind;
    if (purchaseKind !== "" && purchaseKind !== "car" && purchaseKind !== "home" && purchaseKind !== "other")
      throw new InputError("Invalid purchase type");

    await callReducer("run_what_if", {
      customer_id: customerId,
      include_external: false,
      income_mult: boundedNumber(body.income_mult, 0, 1.5, "income multiplier"),
      category_mults: categoryMults,
      one_off_cents: boundedNumber(body.one_off_cents, 0, 100_000_000, "one-time expense"),
      one_off_day: boundedInteger(body.one_off_day, 0, 179, "one-time expense date"),
      move_to_debt_cents: boundedNumber(body.move_to_debt_cents, 0, 100_000_000, "debt payment"),
      job_loss_months: boundedInteger(body.job_loss_months, 0, 6, "job loss duration"),
      card_apr_bump_pct: boundedNumber(body.card_apr_bump_pct, 0, 36, "APR adjustment"),
      purchase_kind: purchaseKind,
      purchase_price_cents: boundedNumber(body.purchase_price_cents, 0, 200_000_000, "purchase amount"),
      down_payment_cents: boundedNumber(body.down_payment_cents, 0, 200_000_000, "down payment"),
      loan_apr_pct: boundedNumber(body.loan_apr_pct, 0, 36, "loan APR"),
      loan_term_months: boundedInteger(body.loan_term_months, 6, 360, "loan term"),
      purchase_in_days: boundedInteger(body.purchase_in_days, 0, 179, "purchase date"),
    });

    const savedScenario = (await select(
      `SELECT scenario_json, forecast_json FROM future_scenario WHERE scenario_id = '${customerId}|user'`,
    ))[0];
    if (!savedScenario) throw new Error("The scenario was saved, but its forecast could not be read");
    const forecast = JSON.parse(String(savedScenario.forecast_json)) as Array<{ day_offset: number }>;
    return Response.json({
      scenario: JSON.parse(String(savedScenario.scenario_json)),
      forecast: forecast.sort((a, b) => Number(a.day_offset) - Number(b.day_offset)),
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: error instanceof InputError ? 400 : 502 });
  }
}

function boundedInteger(value: unknown, min: number, max: number, name: string) {
  const parsed = boundedNumber(value, min, max, name);
  if (!Number.isInteger(parsed)) throw new InputError(`Invalid ${name}`);
  return parsed;
}
