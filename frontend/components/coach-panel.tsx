"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

import "./coach-panel.css";
import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLiveData } from "./live-data-provider";
import type { QaRow, CoachScenario, ScenarioForecastPoint } from "@/lib/live-data";

const EXAMPLES = [
  "If I buy a $30,000 car with $5,000 down, will I still have enough for emergencies?",
  "How am I doing financially?",
  "What if I lose my job for 3 months?",


];
export const DISCLAIMER = "Educational tool using synthetic data — not financial advice.";
const VERDICT: Record<string, string> = { comfortable: "Comfortable", tight: "Tight", risky: "Risky" };

interface Answer { question: string; answer: string; verdict: string; interpretation: string; supported: boolean; source: string }

export default function CoachPanel({ navigateOnAsk = false, initialQuestion = "", suggestions, onScenario }: { navigateOnAsk?: boolean; initialQuestion?: string; suggestions?: string[]; onScenario?: (scenario:CoachScenario,forecast:ScenarioForecastPoint[])=>void }) {
  const router = useRouter();
  const autoAsked = useRef(false);
  const { customerId, data, reload, loading } = useLiveData();
  const [question, setQuestion] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Answer | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    if (navigateOnAsk) { router.push(`/coach?question=${encodeURIComponent(text)}`); return; }
    setBusy(true); setError(null); setQuestion(text);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, question: text }) });
      const body = await r.json() as Omit<Answer,"question"> & { error?: string; scenario?: CoachScenario | null; forecast?: ScenarioForecastPoint[] };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setCurrent({ question: text, ...body });
      if(body.scenario) onScenario?.(body.scenario,body.forecast ?? []);
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!initialQuestion || navigateOnAsk || loading || autoAsked.current) return;
    autoAsked.current = true;
    void ask(initialQuestion);
  }, [initialQuestion, navigateOnAsk, loading, customerId]);
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(question); };

  const history = ((data?.qa ?? []) as QaRow[])
    .filter(r => r.supported && r.question !== current?.question)
    .sort((a, b) => Number(b.qa_id) - Number(a.qa_id))
    .slice(0, 4);

  return <section className="panel coach-panel" aria-labelledby="coach-title">
    <div className="panel-heading"><div><h2 id="coach-title"><Bot size={18} strokeWidth={1.7} aria-label="AI chatbot" /> Ask the coach</h2></div></div>
    <form className="coach-form" onSubmit={submit}>
      <label htmlFor="coach-question" className="sr-only">Your question</label>
      <input id="coach-question" value={question} maxLength={300} placeholder="e.g. Can I afford a $1,500 laptop in December?" onChange={event => setQuestion(event.target.value)} disabled={busy} />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Ask"}</button>
    </form>
    <div className="coach-examples" aria-label="Example questions">{(suggestions ?? EXAMPLES).map(q => <button key={q} type="button" disabled={busy} onClick={() => void ask(q)}>{q}</button>)}</div>
    <div aria-live="polite">
      {busy && <p className="coach-status">Running the simulations and checking the answer… this can take a few seconds.</p>}
      {error && <p className="coach-error" role="alert">{error}</p>}
      {current && !busy && <article className="coach-answer">
        <div className="coach-answer-head">{current.verdict && <span className="coach-verdict" data-verdict={current.verdict}>{VERDICT[current.verdict] ?? current.verdict}</span>}<strong>{current.question}</strong></div>
        {current.interpretation && <p className="coach-read">Understood as: {current.interpretation}</p>}
        <p className="coach-text">{current.answer}</p>
        <small>{current.source === "groq" ? "AI-written; every number was checked against the forecast." : "Standard answer (the AI wording didn’t pass the number check or isn’t available)."}</small>
        <p className="coach-disclaimer">Forecasts are ranges, not promises. {DISCLAIMER}</p>
      </article>}
    </div>

    {!navigateOnAsk && history.length > 0 && <div className="coach-history"><h3>Earlier questions</h3>{history.map(h => <details key={String(h.qa_id)}><summary>{h.verdict && <span className="coach-verdict" data-verdict={h.verdict}>{VERDICT[h.verdict] ?? h.verdict}</span>}{h.question}</summary><p className="coach-text">{h.answer}</p></details>)}</div>}
  </section>;
}
