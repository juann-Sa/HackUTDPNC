"""Held-out-customer validation: does the forecaster work on people it has never seen,
and does it adapt to people who spend differently as their history grows?

Design
  * 5 folds by customer, stratified by archetype (each fold: 8 mainstream + 2 of each other type).
    Archetype labels are used ONLY to build folds and report results, never as model input.
  * Train on 80 customers (Nov 2024 - Apr 2026). Test on the other 20: forecast May - Oct 2026
    from the end of April, giving each test customer only its last n months of history, n in {6, 12, 18}.
  * Methods
      pop_season      level x national (population) seasonal factor
      personal_shrink level x (population factor shifted toward the customer's own pattern),
                      weight w = n_m / (n_m + k) where n_m = times that month was observed; k tuned on train
      seasonal_naive  same month last year (falls back to level when not available)
      ml_pop          LightGBM, population features only
      ml_personal     LightGBM, + customer's own month-of-year deviation and its observation count

Usage:
  python validate_customers.py <data-dir> <out-dir>                         # May-Oct 2026 window
  python validate_customers.py <data-dir> <out-dir> --origin 11 --k 0.5     # Nov 2025-Apr 2026 (holidays)
With --origin, training rows and population factors only use months up to the origin (no time leakage),
and available history is capped by the origin.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

DATA, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
args = sys.argv[3:]
ORIGIN = int(args[args.index("--origin") + 1]) if "--origin" in args else 17   # 17 = 2026-04
FIXED_K = float(args[args.index("--k") + 1]) if "--k" in args else None
H, TRAIN_END = 6, ORIGIN
HIST = [n for n in [6, 12, 18] if n <= ORIGIN + 1]
K_GRID = [0.25, 0.5, 1, 2, 4, 8, 16]
SEED = 360

tx = pd.read_csv(DATA / "transactions.csv")
prof = pd.read_csv(DATA / "profiles.csv").set_index("customer_id")
arch = pd.read_csv(DATA / "customer_archetypes.csv").set_index("customer_id").archetype
exp = tx[tx.flow_class == "expense"].copy()
exp["month"] = exp.posted_date.str[:7]
panel = exp.groupby(["customer_id", "category", "month"]).amount.sum().unstack("month").sort_index(axis=1).fillna(0)
months = list(panel.columns)
moy = np.array([int(m[5:]) for m in months])
keys = list(panel.index)
CATS = sorted({c for _, c in keys})
RAW = panel.values
Y = RAW.clip(min=1.0)
LOGY = np.log(Y)
idx_by_cust = {}
for i, (c, _) in enumerate(keys):
    idx_by_cust.setdefault(c, []).append(i)

# ---------- folds: stratified by archetype ----------
rng = np.random.default_rng(SEED)
fold_of = {}
for a, group in arch.groupby(arch):
    ids = list(group.index)
    rng.shuffle(ids)
    for j, cid in enumerate(ids):
        fold_of[cid] = j % 5


def pop_factors(train_customers):
    """Population log seasonal factor per category/month from training customers, train window."""
    out = {}
    for c in CATS:
        rows = [i for i, k in enumerate(keys) if k[1] == c and k[0] in train_customers]
        y = Y[rows, :TRAIN_END + 1]
        lr = np.log(y / y.mean(axis=1, keepdims=True))
        out[c] = np.array([lr[:, moy[:TRAIN_END + 1] == m].mean() for m in range(1, 13)])
    return out


def state(i, o, start, pop):
    """Level and personal month-of-year deviation from history Y[i, start..o]."""
    cat = keys[i][1]
    t = np.arange(start, o + 1)
    d = LOGY[i, t] - pop[cat][moy[t] - 1]          # deseasonalized by population pattern
    lvl = d[-12:].mean()
    r = d - lvl
    own = np.full(12, np.nan)
    cnt = np.zeros(12)
    for m in range(1, 13):
        sel = moy[t] == m
        if sel.any():
            own[m - 1] = r[sel].mean()
            cnt[m - 1] = sel.sum()
    return lvl, own, cnt, d


def row(i, o, h, start, pop, k):
    cust, cat = keys[i]
    lvl, own, cnt, d = state(i, o, start, pop)
    tm = o + h
    m = moy[tm] - 1
    w = cnt[m] / (cnt[m] + k)
    own_m = 0.0 if np.isnan(own[m]) else own[m]
    ly = tm - 12
    return {
        "customer": cust, "category": cat, "h": h, "target_month": tm, "hist_len": o - start + 1,
        "level": lvl, "actual": RAW[i, tm], "y": LOGY[i, tm] - lvl,
        # population features
        "moy": int(moy[tm]), "cat": CATS.index(cat), "pop_target": pop[cat][m],
        "dev_last": d[-1] - lvl, "dev_mean3": d[-3:].mean() - lvl,
        "ly_dev": (LOGY[i, ly] - lvl) if ly >= start else np.nan,
        "spend_to_income": float(np.exp(lvl) / prof.loc[cust, "monthly_income"]),
        # personal features
        "own_target": own[m], "own_count": cnt[m], "shrunk_target": pop[cat][m] + w * own_m,
        # baselines (dollars)
        "pred_pop_season": np.exp(lvl + pop[cat][m]),
        "pred_personal_shrink": np.exp(lvl + pop[cat][m] + w * own_m),
        "pred_seasonal_naive": RAW[i, ly] if ly >= start else np.exp(lvl + pop[cat][m]),
    }


POP_FEATS = ["h", "moy", "cat", "pop_target", "dev_last", "dev_mean3", "ly_dev", "hist_len", "spend_to_income"]
PERS_FEATS = POP_FEATS + ["own_target", "own_count", "shrunk_target"]
params = dict(objective="regression_l1", learning_rate=0.03, num_leaves=15, min_data_in_leaf=40,
              feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              seed=SEED, verbose=-1, deterministic=True, num_threads=4)


def wape(df, col):
    return float(np.abs(df.actual - df[col]).sum() / df.actual.sum())


results, chosen_k = [], {}
for fold in range(5):
    test_c = {c for c, f in fold_of.items() if f == fold}
    train_c = set(arch.index) - test_c
    pop = pop_factors(train_c)
    tr_idx = [i for c in sorted(train_c) for i in idx_by_cust[c]]
    te_idx = [i for c in sorted(test_c) for i in idx_by_cust[c]]

    # tune k on TRAIN customers: origin 11 (12 months of history), predict months 12..17
    best = (FIXED_K, None) if FIXED_K is not None else None
    for k in ([] if FIXED_K is not None else K_GRID):
        df = pd.DataFrame([row(i, 11, h, 0, pop, k) for i in tr_idx for h in range(1, H + 1)])
        e = wape(df, "pred_personal_shrink")
        if best is None or e < best[1]:
            best = (k, e)
    k = best[0]
    chosen_k[fold] = k

    # ML training rows: train customers, growing history, targets inside the train window
    tr = pd.DataFrame([row(i, o, h, 0, pop, k) for i in tr_idx for o in range(2, TRAIN_END)
                       for h in range(1, H + 1) if o + h <= TRAIN_END])
    m_pop = lgb.train(params, lgb.Dataset(tr[POP_FEATS], tr.y, categorical_feature=["cat"]), 120)
    m_per = lgb.train(params, lgb.Dataset(tr[PERS_FEATS], tr.y, categorical_feature=["cat"]), 120)

    for n in HIST:
        start = ORIGIN - n + 1
        te = pd.DataFrame([row(i, ORIGIN, h, start, pop, k) for i in te_idx for h in range(1, H + 1)])
        te["pred_ml_pop"] = np.exp(te.level + m_pop.predict(te[POP_FEATS]))
        te["pred_ml_personal"] = np.exp(te.level + m_per.predict(te[PERS_FEATS]))
        te["fold"], te["history_months"] = fold, n
        te["archetype"] = te.customer.map(arch)
        results.append(te)
    print(f"fold {fold}: k={k}, train rows={len(tr)}", flush=True)

res = pd.concat(results, ignore_index=True)
METHODS = ["pred_pop_season", "pred_personal_shrink", "pred_seasonal_naive", "pred_ml_pop", "pred_ml_personal"]
label = {m: m.replace("pred_", "") for m in METHODS}

summary = {}
for n, g in res.groupby("history_months"):
    summary[f"{n}m_all"] = {label[m]: round(100 * wape(g, m), 2) for m in METHODS}
by_arch = {}
for (n, a), g in res.groupby(["history_months", "archetype"]):
    by_arch.setdefault(a, {})[f"{n}m"] = {label[m]: round(100 * wape(g, m), 2) for m in METHODS}
# household totals (what the cash forecast actually uses)
tot = res.groupby(["history_months", "customer", "archetype", "target_month"])[["actual"] + METHODS].sum().reset_index()
summary_total = {f"{n}m": {label[m]: round(100 * wape(g, m), 2) for m in METHODS}
                 for n, g in tot.groupby("history_months")}
tot_arch = {a: {f"{n}m": {label[m]: round(100 * wape(g, m), 2) for m in METHODS}
                for n, g in ga.groupby("history_months")} for a, ga in tot.groupby("archetype")}

out = {"wape_pct_category_level": summary, "wape_pct_household_total": summary_total,
       "wape_pct_by_archetype_category_level": by_arch, "wape_pct_by_archetype_household_total": tot_arch,
       "shrinkage_k_by_fold": chosen_k, "test_customers_per_fold": 20, "folds": 5}
(OUT / "customer_holdout_metrics.json").write_text(json.dumps(out, indent=1))
res.to_csv(OUT / "customer_holdout_predictions.csv", index=False)

pd.set_option("display.width", 200)
for name, d in [("CATEGORY LEVEL, all 100 held out", summary), ("HOUSEHOLD TOTAL", summary_total)]:
    print("\n" + name)
    print(pd.DataFrame(d).T.to_string())
for n in (max(HIST), 6):
    print(f"\nBY ARCHETYPE (category level, {n} months history)")
    print(pd.DataFrame({a: v[f"{n}m"] for a, v in by_arch.items()}).T.to_string())
    print(f"BY ARCHETYPE (household total, {n} months history)")
    print(pd.DataFrame({a: v[f"{n}m"] for a, v in tot_arch.items()}).T.to_string())
print("\nk by fold:", chosen_k)
