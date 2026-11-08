"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dynamic from "next/dynamic";
import { planetOutcome } from "./financial-planet/planet-model";
import "./financial-planet/planet.css";
const FinancialPlanet=dynamic(()=>import("./financial-planet/FinancialPlanet"),{ssr:false});
import AppHeader from "@/components/AppHeader";
import CoachPanel from "@/components/coach-panel";
import LiveDataProvider, { useLiveData } from "@/components/live-data-provider";
import { currency } from "@/lib/mock-data";
import type { CoachScenario, ScenarioForecastPoint } from "@/lib/live-data";

const SUGGESTIONS = [
  "If I buy a $30,000 car with $5,000 down, will I still have enough for emergencies?",
  "What if I save 5% of my income?",
];

const CATEGORIES = [
  ["housing", "Housing / rent"],
  ["utilities", "Utilities"],
  ["groceries", "Groceries"],
  ["transport", "Transportation"],
] as const;
type SpendingCategory = "housing" | "utilities" | "groceries" | "dining" | "transport" | "shopping" | "other_spending";

interface ScenarioControls {
  incomeMult: number;
  categoryMults: Record<SpendingCategory, number>;
  oneOffCents: number;
  oneOffInDays: number;
  moveToDebtCents: number;
  jobLossMonths: number;
  cardAprBumpPct: number;
  purchaseKind: "" | "car" | "home" | "other";
  purchasePriceCents: number;
  downPaymentCents: number;
  loanAprPct: number;
  loanTermMonths: number;
  purchaseInDays: number;
}

const DEFAULT_CONTROLS: ScenarioControls = {
  incomeMult: 1,
  categoryMults: {
    housing: 1,
    utilities: 1,
    groceries: 1,
    dining: 1,
    transport: 1,
    shopping: 1,
    other_spending: 1,
  },
  oneOffCents: 0,
  oneOffInDays: 30,
  moveToDebtCents: 0,
  jobLossMonths: 0,
  cardAprBumpPct: 0,
  purchaseKind: "",
  purchasePriceCents: 0,
  downPaymentCents: 0,
  loanAprPct: 7.5,
  loanTermMonths: 60,
  purchaseInDays: 30,
};

function controlsForScenario(scenario: CoachScenario): ScenarioControls {
  const purchase = scenario.purchase;
  return {
    incomeMult: scenario.incomeMult,
    categoryMults: {
      housing: scenario.categoryMult.housing ?? 1,
      utilities: scenario.categoryMult.utilities ?? 1,
      groceries: scenario.categoryMult.groceries ?? 1,
      dining: scenario.categoryMult.dining ?? 1,
      transport: scenario.categoryMult.transport ?? 1,
      shopping: scenario.categoryMult.shopping ?? 1,
      other_spending: scenario.categoryMult.other_spending ?? 1,
    },
    oneOffCents: scenario.oneOffCents,
    oneOffInDays: scenario.oneOffInDays,
    moveToDebtCents: scenario.moveToDebtCents,
    jobLossMonths: scenario.jobLossMonths,
    cardAprBumpPct: scenario.cardAprBumpPct ?? 0,
    purchaseKind: purchase?.kind ?? "",
    purchasePriceCents: purchase?.priceCents ?? 0,
    downPaymentCents: purchase?.downCents ?? 0,
    loanAprPct: purchase?.aprPct ?? 7.5,
    loanTermMonths: purchase?.termMonths ?? 60,
    purchaseInDays: purchase?.inDays ?? 30,
  };
}

function purchaseDefaults(kind: ScenarioControls["purchaseKind"]) {
  if (kind === "home") return { apr: 6.5, term: 360 };
  if (kind === "other") return { apr: 11, term: 36 };
  return { apr: 7.5, term: 60 };
}

function axisCurrency(value: number) {
  const amount = Number(value);
  if (Math.abs(amount) >= 1_000) {
    return `${amount < 0 ? "-$" : "$"}${(Math.abs(amount) / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  }
  return currency(amount);
}

function percentFromMultiplier(multiplier: number) {
  return Math.round((multiplier - 1) * 100);
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const centered = min < 0 && max > 0;
  const position = centered ? (value < 0 ? value / -min * 100 : value / max * 100) : value;
  function change(position: number) {
    const actual = centered ? (position < 0 ? position / 100 * -min : position / 100 * max) : position;
    onChange(Math.max(min, Math.min(max, Math.round(actual / step) * step)));
  }
  return (
    <label className="future-slider">
      <span className="future-slider-label">{label}<output>{display}</output></span>
      <input
        type="range"
        min={centered ? -100 : min}
        max={centered ? 100 : max}
        step={centered ? "any" : step}
        value={position}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        onChange={(event: ChangeEvent<HTMLInputElement>) => change(Number(event.target.value))}
      />
    </label>
  );
}

function BigPurchasePanel({
  kind,
  amountCents,
  saving,
  onKindChange,
  onAmountChange,
}: {
  kind: ScenarioControls["purchaseKind"];
  amountCents: number;
  saving: boolean;
  onKindChange: (kind: ScenarioControls["purchaseKind"]) => void;
  onAmountChange: (amountCents: number) => void;
}) {
  return (
    <section className="future-panel future-purchase" aria-labelledby="future-purchase-title">
      <div className="panel-heading">
        <div>
          <h2 id="future-purchase-title">Major purchase</h2>
        </div>
      </div>
      <div className="future-purchase-fields">
        <label className="future-select">
          <span>Purchase type</span>
          <select
            value={kind}
            onChange={(event) => onKindChange(event.target.value as ScenarioControls["purchaseKind"])}
          >
            <option value="">Choose one</option>
            <option value="car">Car</option>
            <option value="home">Home</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="future-purchase-amount">
          <span>Purchase amount</span>
          <span className="future-currency-input">
            <span aria-hidden="true">$</span>
            <input
              type="number"
              min="0"
              max="2000000"
              step="500"
              inputMode="decimal"
              aria-label="Purchase amount in dollars"
              placeholder="0"
              disabled={!kind}
              value={amountCents ? amountCents / 100 : ""}
              onChange={(event) => onAmountChange(Math.round(Number(event.target.value) * 100))}
            />
          </span>
        </label>
      </div>
      {saving && <p className="future-purchase-status" role="status">Updating your forecast…</p>}
    </section>
  );
}

function ScenarioControlPanel({
  controls,
  setControls,
  coachControls,
  saving,
  error,
  onApply,
  onReset,
}: {
  controls: ScenarioControls;
  setControls: (update: (current: ScenarioControls) => ScenarioControls) => void;
  coachControls: ScenarioControls | null;
  saving: boolean;
  error: string | null;
  onApply: () => void;
  onReset: () => void;
}) {
  const baseline = coachControls ?? DEFAULT_CONTROLS;
  const changed = JSON.stringify(controls) !== JSON.stringify(baseline);
  const setCategory = (category: SpendingCategory, percent: number) =>
    setControls((current) => ({
      ...current,
      categoryMults: { ...current.categoryMults, [category]: 1 + percent / 100 },
    }));
  const setExtras = (percent: number) =>
    setControls((current) => ({
      ...current,
      categoryMults: {
        ...current.categoryMults,
        dining: 1 + percent / 100,
        shopping: 1 + percent / 100,
        other_spending: 1 + percent / 100,
      },
    }));
  const extrasPercent = percentFromMultiplier(controls.categoryMults.dining);

  return (
    <section className="future-panel future-controls" aria-labelledby="future-controls-title">
      <div className="panel-heading">
        <div>
          <h2 id="future-controls-title">What if?</h2>
        </div>
      </div>

      <div className="future-slider-list">
        <Slider
          label="Monthly income"
          value={percentFromMultiplier(controls.incomeMult)}
          min={-100}
          max={50}
          step={1}
          display={`${percentFromMultiplier(controls.incomeMult) > 0 ? "+" : ""}${percentFromMultiplier(controls.incomeMult)}%`}
          onChange={(percent) => setControls((current) => ({ ...current, incomeMult: 1 + percent / 100 }))}
        />
        {CATEGORIES.map(([category, label]) => {
          const percent = percentFromMultiplier(controls.categoryMults[category]);
          return (
            <Slider
              key={category}
              label={`${label} change`}
              value={percent}
              min={-100}
              max={200}
              step={1}
              display={`${percent > 0 ? "+" : ""}${percent}%`}
              onChange={(value) => setCategory(category, value)}
            />
          );
        })}
        <Slider
          label="Dining, shopping & other extras"
          value={extrasPercent}
          min={-100}
          max={200}
          step={1}
          display={`${extrasPercent > 0 ? "+" : ""}${extrasPercent}%`}
          onChange={setExtras}
        />
      </div>

      <details className="future-advanced-controls">
        <summary>Debt, one-time costs and other changes</summary>
        <div className="future-slider-list">
          <Slider
            label="Pay down high-interest debt now"
            value={controls.moveToDebtCents}
            min={0}
            max={10_000_000}
            step={50_000}
            display={currency(controls.moveToDebtCents / 100)}
            onChange={(value) => setControls((current) => ({ ...current, moveToDebtCents: value }))}
          />
          <Slider
            label="One-time expense"
            value={controls.oneOffCents}
            min={0}
            max={10_000_000}
            step={50_000}
            display={currency(controls.oneOffCents / 100)}
            onChange={(value) => setControls((current) => ({ ...current, oneOffCents: value }))}
          />
          {controls.oneOffCents > 0 && (
            <Slider
              label="Expense in days"
              value={controls.oneOffInDays}
              min={0}
              max={179}
              step={1}
              display={`${controls.oneOffInDays} days`}
              onChange={(value) => setControls((current) => ({ ...current, oneOffInDays: value }))}
            />
          )}
          <Slider
            label="Months without income"
            value={controls.jobLossMonths}
            min={0}
            max={6}
            step={1}
            display={`${controls.jobLossMonths} months`}
            onChange={(value) => setControls((current) => ({ ...current, jobLossMonths: value }))}
          />
          <Slider
            label="Credit-card APR increase"
            value={controls.cardAprBumpPct}
            min={0}
            max={36}
            step={0.5}
            display={`${controls.cardAprBumpPct.toFixed(1)} percentage points`}
            onChange={(value) => setControls((current) => ({ ...current, cardAprBumpPct: value }))}
          />
        </div>
      </details>

      {coachControls && (
        <button className="future-reset-button" type="button" disabled={saving} onClick={onReset}>
          Reset to the coach&apos;s sliders
        </button>
      )}
      <button className="future-apply-button" type="button" disabled={!changed || saving} onClick={() => onApply()}>
        {saving ? "Updating forecast…" : "Apply my slider changes"}
      </button>
      {error && <p className="future-control-error" role="alert">{error}</p>}
    </section>
  );
}

function FutureDashboardContent() {
  const [visualMode,setVisualMode]=useState<"chart"|"planet">("chart");
  const { customerId, data, error, loading, call } = useLiveData();
  const [controls, setControls] = useState<ScenarioControls>(DEFAULT_CONTROLS);
  const [coachControls, setCoachControls] = useState<ScenarioControls | null>(null);
  const [coachForecast, setCoachForecast] = useState<ScenarioForecastPoint[]>([]);
  const [userForecast, setUserForecast] = useState<ScenarioForecastPoint[]>([]);
  const [saving, setSaving] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const purchaseUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenarioRequestId = useRef(0);

  useEffect(() => () => {
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
  }, []);

  const activeCustomerId = data?.customer?.[0]?.customer_id;
  useEffect(() => {
    if (activeCustomerId !== customerId) return;
    const coach = data?.future_scenario?.find((scenario) => scenario.scenario_type === "coach");
    const user = data?.future_scenario?.find((scenario) => scenario.scenario_type === "user");
    setCoachControls(coach ? controlsForScenario(coach.scenario) : null);
    setCoachForecast(coach?.forecast ?? []);
    setUserForecast(user?.forecast ?? []);
    setControls(
      user
        ? controlsForScenario(user.scenario)
        : coach
          ? controlsForScenario(coach.scenario)
          : DEFAULT_CONTROLS,
    );
  }, [activeCustomerId, customerId, data?.future_scenario]);

  const baselinePoints = useMemo(
    () =>
      (data?.timeline_360 ?? [])
        .filter((row) => row.day_offset >= 0 && row.day_offset <= 180)
        .slice()
        .sort((a, b) => a.day_offset - b.day_offset),
    [data],
  );
  const dateByDay = useMemo(
    () => new Map(baselinePoints.map((point) => [point.day_offset, point.date])),
    [baselinePoints],
  );
  const coachByDay = useMemo(() => new Map(coachForecast.map((point) => [point.day_offset, point])), [coachForecast]);
  const userByDay = useMemo(() => new Map(userForecast.map((point) => [point.day_offset, point])), [userForecast]);
  const activeScenarioForecast = userForecast.length > 0 ? userByDay : coachByDay;
  const activeScenarioName = userForecast.length > 0
    ? "Your what-if"
    : coachForecast.length > 0
      ? "AI coach scenario"
      : null;
  const activeScenarioColor = userForecast.length > 0 ? "#3976b9" : "#f58025";
  const chartPoints = useMemo(
    () =>
      baselinePoints.map((point) => ({
        day: point.day_offset,
        date: point.date,
        baseline: point.continue_mid_cents == null ? null : point.continue_mid_cents / 100,
        comparison: (activeScenarioForecast.get(point.day_offset)?.mid_cents ?? null) == null
          ? null
          : Number(activeScenarioForecast.get(point.day_offset)?.mid_cents) / 100,
      })),
    [activeScenarioForecast, baselinePoints],
  );
  const planet=useMemo(()=>{
    const baseline=baselinePoints.map(point=>({day:point.day_offset,midCents:point.continue_mid_cents,lowCents:point.continue_low_cents}));
    const active=userForecast.length?userForecast:coachForecast;
    const scenario=active.length?active.map(point=>({day:point.day_offset,midCents:point.mid_cents,lowCents:point.low_cents})):baseline;
    return data?.customer[0]?.customer_id===customerId ? planetOutcome(scenario,baseline,data?.book_snapshot[0]?.monthly_outflow_cents??null) : planetOutcome([],[],null);
  },[baselinePoints,userForecast,coachForecast,data,customerId]);
  const formatDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  function applyCoachScenario(scenario: CoachScenario, forecast: ScenarioForecastPoint[]) {
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
    purchaseUpdateTimer.current = null;
    scenarioRequestId.current++;
    setSaving(false);
    const updatedControls = controlsForScenario(scenario);
    setControls(updatedControls);
    setCoachControls(updatedControls);
    setCoachForecast(forecast);
    setUserForecast([]);
    setScenarioError(null);
  }

  async function applyUserScenario(nextControls: ScenarioControls = controls) {
    const requestId = ++scenarioRequestId.current;
    setSaving(true);
    setScenarioError(null);
    try {
      const response = await fetch("/api/what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          income_mult: nextControls.incomeMult,
          category_mults: nextControls.categoryMults,
          one_off_cents: nextControls.oneOffCents,
          one_off_day: nextControls.oneOffInDays,
          move_to_debt_cents: nextControls.moveToDebtCents,
          job_loss_months: nextControls.jobLossMonths,
          card_apr_bump_pct: nextControls.cardAprBumpPct,
          purchase_kind: nextControls.purchaseKind,
          purchase_price_cents: nextControls.purchasePriceCents,
          down_payment_cents: nextControls.downPaymentCents,
          loan_apr_pct: nextControls.loanAprPct,
          loan_term_months: nextControls.loanTermMonths,
          purchase_in_days: nextControls.purchaseInDays,
        }),
      });
      const body = await response.json() as { forecast?: ScenarioForecastPoint[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      if (requestId === scenarioRequestId.current) setUserForecast(body.forecast ?? []);
    } catch (cause) {
      if (requestId === scenarioRequestId.current) setScenarioError((cause as Error).message);
    } finally {
      if (requestId === scenarioRequestId.current) setSaving(false);
    }
  }

  function schedulePurchaseForecast(next: ScenarioControls) {
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
    purchaseUpdateTimer.current = setTimeout(() => {
      purchaseUpdateTimer.current = null;
      void applyUserScenario(next);
    }, 450);
  }

  function setPurchaseKind(kind: ScenarioControls["purchaseKind"]) {
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
    purchaseUpdateTimer.current = null;
    const defaults = purchaseDefaults(kind);
    const next = {
      ...controls,
      purchaseKind: kind,
      purchasePriceCents: kind ? controls.purchasePriceCents : 0,
      downPaymentCents: 0,
      loanAprPct: defaults.apr,
      loanTermMonths: defaults.term,
    };
    setControls(next);
    if (!kind && (userForecast.length > 0 || coachControls?.purchaseKind)) schedulePurchaseForecast(next);
    else if (kind && next.purchasePriceCents > 0) schedulePurchaseForecast(next);
  }

  function setPurchaseAmount(amountCents: number) {
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
    purchaseUpdateTimer.current = null;
    const next = {
      ...controls,
      purchasePriceCents: Math.max(0, Math.min(200_000_000, amountCents)),
      downPaymentCents: Math.min(controls.downPaymentCents, Math.max(0, amountCents)),
    };
    setControls(next);
    if (next.purchaseKind && next.purchasePriceCents > 0) schedulePurchaseForecast(next);
    else if (!next.purchasePriceCents && (userForecast.length > 0 || coachControls?.purchaseKind)) schedulePurchaseForecast(next);
  }

  async function resetToCoachScenario() {
    if (!coachControls) return;
    if (purchaseUpdateTimer.current) clearTimeout(purchaseUpdateTimer.current);
    purchaseUpdateTimer.current = null;
    scenarioRequestId.current++;
    setSaving(true);
    setControls(coachControls);
    setUserForecast([]);
    setScenarioError(null);
    try {
      await call("clear_user_future_scenario", { customer_id: customerId });
    } catch (cause) {
      setScenarioError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pnc-dash future-page">
      <AppHeader current="future" />
      <main className="future-main" aria-label="Future">
        <div className="future-heading">
          <h1>180&deg; Future</h1>
        </div>

        {error && (
          <div className="live-error" role="alert">
            Can’t load live data from SpacetimeDB: {error}. Is <code>spacetime start</code> running and
            the spacetime360 module published?
          </div>
        )}

        <div className="future-overview">
          <div className="future-forecast-stack">
            <section className="future-panel" aria-labelledby="future-forecast-title">
              <div className="panel-heading">
                <div>
                  <h2 id="future-forecast-title">180-day Outlook</h2>
                </div>
              </div>
              <div className="future-mode-toggle" role="group" aria-label="Forecast visualization mode"><button type="button" aria-pressed={visualMode==='chart'} onClick={()=>setVisualMode('chart')}>Chart View</button><button type="button" aria-pressed={visualMode==='planet'} onClick={()=>setVisualMode('planet')}>Financial Planet</button></div>
              {visualMode==='planet' ? <FinancialPlanet outcome={planet} updating={saving} source={activeScenarioName??'Your current path'} /> : <>
              <div className="future-legend" aria-label="Forecast lines">
                <span><i className="baseline-key" />Your current path</span>
                {activeScenarioName && (
                  <span><i className={userForecast.length > 0 ? "user-key" : "coach-key"} />{activeScenarioName}</span>
                )}
              </div>

              {loading ? (
                <div className="future-chart-message" role="status">Loading your forecast…</div>
              ) : baselinePoints.length === 0 ? (
                <div className="future-chart-message">
                  A 180-day forecast isn’t available for this customer yet.
                </div>
              ) : (
                <div className="future-chart" role="img" aria-label={`180-day net cash forecast showing your current path${activeScenarioName ? ` and ${activeScenarioName}` : ""}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartPoints} margin={{ top: 16, right: 12, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#eeeeee" vertical={false} strokeDasharray="3 5" />
                      <XAxis
                        dataKey="day"
                        type="number"
                        domain={[0, 180]}
                        ticks={[0, 30, 60, 90, 120, 150, 180]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#737373", fontSize: 10 }}
                        tickMargin={10}
                        tickFormatter={(value) => {
                          const day = Number(value);
                          const date = dateByDay.get(day);
                          return day === 0 ? "Today" : day === 180 ? "180 days" : date ? formatDate(date) : `${day}d`;
                        }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#737373", fontSize: 10 }}
                        tickFormatter={axisCurrency}
                        width={58}
                      />
                      <Tooltip
                        labelFormatter={(value) => {
                          const day = Number(value);
                          const date = dateByDay.get(day);
                          return date ? `${day === 0 ? "Today" : `Day ${day}`} · ${formatDate(date)}` : `Day ${day}`;
                        }}
                        formatter={(value, name) => [currency(Number(value)), String(name)]}
                        contentStyle={{ border: "1px solid #e8e8e8", borderRadius: 10, fontSize: 12 }}
                      />
                      <Line
                        name="Your current path"
                        type="monotone"
                        dataKey="baseline"
                        stroke="#737373"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
                        connectNulls
                      />
                      {activeScenarioName && (
                        <Line
                          name={activeScenarioName}
                          type="monotone"
                          dataKey="comparison"
                          stroke={activeScenarioColor}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
                          connectNulls
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              </>} 
            </section>
            <BigPurchasePanel
              kind={controls.purchaseKind}
              amountCents={controls.purchasePriceCents}
              saving={saving}
              onKindChange={setPurchaseKind}
              onAmountChange={setPurchaseAmount}
            />
          </div>

          <ScenarioControlPanel
            controls={controls}
            setControls={setControls}
            coachControls={coachControls}
            saving={saving}
            error={scenarioError}
            onApply={applyUserScenario}
            onReset={resetToCoachScenario}
          />
        </div>

        <CoachPanel suggestions={SUGGESTIONS} onScenario={applyCoachScenario} />
      </main>
    </div>
  );
}

export default function FutureDashboard() {
  return (
    <LiveDataProvider>
      <FutureDashboardContent />
    </LiveDataProvider>
  );
}
