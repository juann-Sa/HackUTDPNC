"use client";
import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { useLiveData } from "./live-data-provider";
import type { QaRow } from "@/lib/live-data";

const EXAMPLES = [
  "If I buy a $30,000 car with $5,000 down, will I still have enough for emergencies?",
  "How am I doing financially?",
  "What if I lose my job for 3 months?",
  "When will I be debt-free?",
  "What if I cut dining out in half?",
];
export const DISCLAIMER = "Educational tool using synthetic data — not financial advice.";
const VERDICT: Record<string, string> = { comfortable: "Comfortable", tight: "Tight", risky: "Risky" };

interface Answer { question: string; answer: string; verdict: string; interpretation: string; supported: boolean; source: string }

export default function CoachPanel() {
  const { customerId, data, reload } = useLiveData();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Answer | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setError(null); setQuestion(text);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, question: text }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setCurrent({ question: text, ...body });
      reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(question); };

  const dataNote = !data
    ? null
    : data.external_account.length === 0
      ? "Only PNC accounts are included; money held at other banks isn’t counted."
      : "Linked outside accounts count toward your balances; forecasts use PNC accounts only.";

  const history = ((data?.qa ?? []) as QaRow[])
    .filter(r => r.supported && r.question !== current?.question)
    .sort((a, b) => Number(b.qa_id) - Number(a.qa_id))
    .slice(0, 4);

  return <section className="panel coach-panel" aria-labelledby="coach-title">
    <div className="panel-heading"><div><h2 id="coach-title"><Sparkles size={18} aria-hidden /> Ask the coach</h2><p className="coach-sub">Ask about {customerId}&apos;s money: where it stands, or a what-if (a purchase or loan, a pay change, a job loss). It runs the numbers first, then explains them.</p></div></div>
    <form className="coach-form" onSubmit={submit}>
      <label htmlFor="coach-question" className="sr-only">Your question</label>
      <input id="coach-question" value={question} maxLength={300} placeholder="e.g. Can I afford a $1,500 laptop in December?" onChange={event => setQuestion(event.target.value)} disabled={busy} />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Ask"}</button>
    </form>
    <div className="coach-examples" aria-label="Example questions">{EXAMPLES.map(q => <button key={q} type="button" disabled={busy} onClick={() => void ask(q)}>{q}</button>)}</div>
    <div aria-live="polite">
      {busy && <p className="coach-status">Running the simulations and checking the answer… this can take a few seconds.</p>}
      {error && <p className="coach-error" role="alert">{error}</p>}
      {current && !busy && <article className="coach-answer">
        <div className="coach-answer-head">{current.verdict && <span className="coach-verdict" data-verdict={current.verdict}>{VERDICT[current.verdict] ?? current.verdict}</span>}<strong>{current.question}</strong></div>
        {current.interpretation && <p className="coach-read">Understood as: {current.interpretation}</p>}
        <p className="coach-text">{current.answer}</p>
        <small>{current.source === "groq" ? "AI-written; every number was checked against the forecast." : "Standard answer (the AI wording didn’t pass the number check or isn’t available)."}</small>
        <p className="coach-disclaimer">{dataNote && <>{dataNote} </>}Forecasts are ranges, not promises. {DISCLAIMER}</p>
      </article>}
    </div>
    {!current && dataNote && <p className="coach-data-note">{dataNote}</p>}
    {history.length > 0 && <div className="coach-history"><h3>Earlier questions</h3>{history.map(h => <details key={String(h.qa_id)}><summary>{h.verdict && <span className="coach-verdict" data-verdict={h.verdict}>{VERDICT[h.verdict] ?? h.verdict}</span>}{h.question}</summary><p className="coach-text">{h.answer}</p></details>)}</div>}
  </section>;
}
