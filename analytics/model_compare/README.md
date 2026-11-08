# Open vs. commercial model comparison

Runs the coach's real pipeline (question → scenario JSON → engine → audited answer) on the same questions
for several Groq-hosted models, for customer C006. No SpacetimeDB server needed.

```bash
cd spacetimedb
GROQ_API_KEY=... COMPARE_OUT=../analytics/model_compare/results.json npx vitest run src/model_compare.report.test.ts
# optional: COMPARE_MODELS=openai/gpt-oss-120b,llama-3.1-8b-instant COMPARE_CUSTOMER=C027
```

Writes `results.json` (every reply, tokens, audit problems) and `results.md` (summary table).

| Column | Meaning |
|---|---|
| Valid JSON | the parse reply is a JSON object as-is |
| Correct reading | supported/unsupported right, and key parameters right (e.g. "$2,000" → 200000 cents, "3 months" → 3) |
| Faithful | the answer passes the production number/label audit (`auditReply`), first try and after one retry |
| Latency | median wall-clock ms per call from your machine |
| Est. $/question | tokens × list prices in `spacetimedb/src/eval/model_compare.ts` (verify current Groq prices) |

Every model explains identical engine facts (computed from the expected reading), so faithfulness and tone are
compared like for like. Privacy: these are open-weight models served in Groq's cloud, so data leaves the machine;
a local Ollama model would not (not run here). Only synthetic data is used. The offline scoring tests are in
`spacetimedb/src/eval/model_compare.test.ts`.

## Level 1 vs 2 vs 3 (starter kit implementation levels)

Same what-if questions, same model, same customer at every level; ground truth is the forecast engine.

| Level | What it is |
|---|---|
| 1 | One LLM call gets the raw data and answers (does its own math) |
| 2 | Tool-using agent: the LLM picks approved tools (`get_accounts`, `calculate_health_metrics`, `simulate_scenario`) and answers from their results |
| 3 | Orchestrated workflow (production): LLM reads the question → code validates → engine computes → LLM explains → number audit (+1 retry, else template) |
| 3 + critic | Level 3 plus a supervisor LLM and a reviewer LLM |

Measures per level: LLM calls, median seconds, input and output tokens, $ per question and per 1,000 questions, question read right, verdict agrees with the engine, answers whose numbers are all traceable, untraceable numbers per answer, template fallbacks. Ranks reliable-first, then cost, then time, and names the best level.

```bash
cd spacetimedb
GROQ_API_KEY=... LEVELS_OUT=../analytics/levels/results.json npx vitest run src/levels.report.test.ts
# optional: COMPARE_MODELS=openai/gpt-oss-120b  COMPARE_CUSTOMER=C006
```
Writes `analytics/levels/results.json` (every answer) and `results.md` (the tables and the verdict).
