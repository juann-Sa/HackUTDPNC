// Server-only SpacetimeDB access over its HTTP API (used by the app/api routes).
// The browser never talks to SpacetimeDB directly: no generated bindings, no CORS, and only
// read queries built here plus a short list of reducers can run.

const HOST = (process.env.SPACETIMEDB_HOST ?? "http://localhost:3000").replace(/\/$/, "");
const DB = process.env.SPACETIMEDB_DB ?? "spacetime360";

let token: string | undefined = process.env.SPACETIMEDB_TOKEN || undefined;

async function getToken(): Promise<string> {
  if (token) return token;
  const res = await fetch(`${HOST}/v1/identity`, { method: "POST", cache: "no-store" });
  if (!res.ok) throw new Error(`SpacetimeDB identity request failed (${res.status})`);
  token = ((await res.json()) as { token: string }).token;
  return token;
}

type Json = unknown;
type Row = Record<string, Json>;

const nameOf = (n: Json): string =>
  typeof n === "string" ? n : n && typeof n === "object" && "some" in n ? String((n as { some: Json }).some) : "";

/** Option<T> columns arrive as a sum type; accept every JSON shape SpacetimeDB versions use. */
function isOptionType(ty: Json): boolean {
  if (!ty || typeof ty !== "object" || !("Sum" in ty)) return false;
  const variants = (ty as { Sum: { variants: { name: Json }[] } }).Sum.variants ?? [];
  return variants.length === 2 && nameOf(variants[0].name) === "some" && nameOf(variants[1].name) === "none";
}
function decodeOption(v: Json): Json {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v[0] === 0 ? v[1] : null;
  if (typeof v === "object") {
    const o = v as Record<string, Json>;
    if ("some" in o) return o.some;
    if ("0" in o) return o["0"];
    return null;
  }
  return v;
}

/** Run one SELECT and return rows as plain objects keyed by column name. */
export async function select(query: string): Promise<Row[]> {
  const res = await fetch(`${HOST}/v1/database/${DB}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "text/plain" },
    body: query,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SpacetimeDB query failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as Json;
  const result = (Array.isArray(body) ? body[0] : body) as {
    schema: { elements: { name: Json; algebraic_type: Json }[] };
    rows: Json[][];
  };
  const cols = result.schema.elements.map(e => ({ name: nameOf(e.name), option: isOptionType(e.algebraic_type) }));
  return result.rows.map(r => Object.fromEntries(cols.map((c, i) => [c.name, c.option ? decodeOption(r[i]) : r[i]])));
}

/** Reducers the dashboard may call, with argument order (the HTTP API takes positional args). */
export const REDUCERS: Record<string, string[]> = {
  add_external_account: ["customer_id", "institution", "account_type", "nickname", "balance_cents", "apr_pct", "annual_yield_pct", "monthly_payment_cents"],
  remove_external_account: ["account_id"],
  run_car_options: ["customer_id"],
  run_forecast: ["customer_id", "include_external"],
  run_what_if: ["customer_id", "include_external", "income_mult", "category_mults", "one_off_cents", "one_off_day", "move_to_debt_cents", "job_loss_months", "card_apr_bump_pct", "purchase_kind", "purchase_price_cents", "down_payment_cents", "loan_apr_pct", "loan_term_months", "purchase_in_days"],
  clear_user_future_scenario: ["customer_id"],
  add_goal: ["customer_id", "name", "kind", "target_cents", "target_date"],
  remove_goal: ["goal_id"],
  evaluate_goals: ["customer_id"],
};

export async function callReducer(name: string, args: Record<string, Json>): Promise<void> {
  const order = REDUCERS[name];
  if (!order) throw new Error(`Reducer ${name} is not allowed`);
  const res = await fetch(`${HOST}/v1/database/${DB}/call/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(order.map(k => args[k])),
    cache: "no-store",
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || `Reducer ${name} failed (${res.status})`);
}

/** Call a procedure (same HTTP endpoint as reducers); returns its JSON-decoded result when there is one. */
export async function callProcedure(name: "ask" | "narrate" | "narrate_car", args: unknown[]): Promise<unknown> {
  const res = await fetch(`${HOST}/v1/database/${DB}/call/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 300) || `Procedure ${name} failed (${res.status})`);
  try { return JSON.parse(text); } catch { return text; }
}

export const CUSTOMER_ID = /^C\d{3}$/;
