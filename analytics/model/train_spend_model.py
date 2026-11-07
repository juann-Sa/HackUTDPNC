"""Train a global 1-6 month spending forecaster, per customer x category.

Split (the "180 back / 180 forward" idea):
  train  = 2024-11 .. 2026-04  (18 months)
  test   = 2026-05 .. 2026-10  (the last 180 days, forecast from origin 2026-04)

Target: log(category spend in month) - trailing seasonally adjusted level of that customer/category.
Direct multi-horizon: one LightGBM model, horizon h and category are features.
Seasonal factors used as features are estimated from the TRAIN window only (pooled across customers).
Compared against simple baselines; reported per category and for household totals.

Usage:
  python train_spend_model.py <data-dir> <output-dir>            # validate: train to 2026-04, test May-Oct
  python train_spend_model.py <data-dir> <output-dir> --final    # production: refit on all 24 months,
                                                                 # same rounds, + event calendar for next 180 days
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

DATA, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
FINAL = "--final" in sys.argv
TRAIN_END = 23 if FINAL else 17   # month index (2024-11 = 0); 17 = 2026-04, 23 = 2026-10
H = 6                   # horizons in months (~180 days)
SEED = 360

# ---------- 1. Panel: (customer, category) x month ----------
tx = pd.read_csv(DATA / "transactions.csv")
prof = pd.read_csv(DATA / "profiles.csv").set_index("customer_id")
exp = tx[tx.flow_class == "expense"].copy()
exp["month"] = exp.posted_date.str[:7]
panel = exp.groupby(["customer_id", "category", "month"]).amount.sum().unstack("month").sort_index(axis=1)
panel = panel.fillna(0.0)
months = list(panel.columns)
moy = np.array([int(m[5:]) for m in months])
keys = list(panel.index)                           # (customer, category)
CATS = sorted({c for _, c in keys})
Y = panel.values.clip(min=1.0)                     # dollars; floor avoids log(0) for rare lines

# Pooled seasonal factors per category (log), train window only.
seas = {}
for c in CATS:
    rows = [i for i, k in enumerate(keys) if k[1] == c]
    yt = Y[rows, :TRAIN_END + 1]
    lr = np.log(yt / yt.mean(axis=1, keepdims=True))
    seas[c] = {m: float(lr[:, moy[:TRAIN_END + 1] == m].mean()) for m in range(1, 13)}
seas_arr = {c: np.array([seas[c][m] for m in moy]) for c in CATS}

# Category shares of total (for splitting a total forecast), train window only.
tr_exp = exp[exp.month <= months[TRAIN_END]]
shares = tr_exp.groupby(["customer_id", "category"]).amount.sum()
shares = (shares / shares.groupby(level=0).transform("sum")).unstack(fill_value=0).round(6)


def features(i, o, h):
    cust, cat = keys[i]
    s = seas_arr[cat]
    hist = Y[i, :o + 1]
    deseason = np.log(hist) - s[:o + 1]
    lvl = deseason[-12:].mean()
    tgt = o + h
    ly = tgt - 12
    return {
        "h": h,
        "moy": int(moy[tgt]),
        "cat": CATS.index(cat),
        "seas_target": s[tgt],
        "seas_origin": s[o],
        "dev_last": deseason[-1] - lvl,
        "dev_mean3": deseason[-3:].mean() - lvl,
        "trend6": np.polyfit(np.arange(min(6, o + 1)), deseason[-6:], 1)[0] if o >= 2 else 0.0,
        "ly_dev": (np.log(Y[i, ly]) - lvl) if ly >= 0 else np.nan,
        "hist_len": o + 1,
        "spend_to_income": float(np.exp(lvl) / prof.loc[cust, "monthly_income"]),
    }, lvl


def build(origins):
    rows = []
    for i, (cust, cat) in enumerate(keys):
        for o in origins:
            for h in range(1, H + 1):
                if o + h >= Y.shape[1]:
                    continue
                f, lvl = features(i, o, h)
                f.update(customer=cust, category=cat, origin=o, target_month=o + h, level=lvl,
                         actual=panel.values[i, o + h], y=np.log(Y[i, o + h]) - lvl)
                rows.append(f)
    return pd.DataFrame(rows)


train = build(range(2, TRAIN_END))
train = train[train.target_month <= TRAIN_END].reset_index(drop=True)
test = build([TRAIN_END])
FEATS = ["h", "moy", "cat", "seas_target", "seas_origin", "dev_last", "dev_mean3", "trend6",
         "ly_dev", "hist_len", "spend_to_income"]

# ---------- 2. Model ----------
params = dict(objective="regression_l1", learning_rate=0.03, num_leaves=15, min_data_in_leaf=30,
              feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              seed=SEED, verbose=-1, deterministic=True)
if FINAL:
    # Reuse the round count chosen during validation; no peeking at a test set.
    rounds = json.loads((OUT.parent / "out_seasonal" / "metrics.json").read_text())["rounds"]
else:
    cut = TRAIN_END - 2
    tr, va = train[train.target_month < cut], train[train.target_month >= cut]
    probe = lgb.train(params, lgb.Dataset(tr[FEATS], tr.y, categorical_feature=["cat"]), num_boost_round=3000,
                      valid_sets=[lgb.Dataset(va[FEATS], va.y, categorical_feature=["cat"])],
                      callbacks=[lgb.early_stopping(150, verbose=False)])
    rounds = max(probe.best_iteration, 50)
model = lgb.train(params, lgb.Dataset(train[FEATS], train.y, categorical_feature=["cat"]),
                  num_boost_round=rounds)
train["res"] = train.y - model.predict(train[FEATS])
sigma = train.groupby(["category", "h"]).res.std().unstack().round(4)

if FINAL:
    sys.path.insert(0, str(Path(__file__).parent))
    from seasonality import events_for
    model.save_model(str(OUT / "spend_model.txt"))
    future = [(2026 + (10 + k) // 12, (10 + k) % 12 + 1) for k in range(H)]   # Nov 2026 .. Apr 2027
    calendar = {f"{y}-{m:02d}": {c: [{"day": d, "share": s, "event": n} for d, s, n in v]
                                 for c, v in events_for(y, m).items()} for y, m in future}
    with open(OUT / "spend_model.json", "w") as f:
        json.dump({
            "model": model.dump_model(), "features": FEATS, "categories": CATS,
            "target": "log(category monthly spend) - trailing seasonally adjusted level",
            "seasonal_log_factors": seas,
            "residual_sigma_by_category_horizon": sigma.to_dict(orient="index"),
            "category_shares": shares.to_dict(orient="index"),
            "event_calendar_next_180d": calendar,
            "train_window": [months[0], months[TRAIN_END]], "rounds": rounds,
            "validation": "see out_seasonal/metrics.json (trained to 2026-04, tested May-Oct 2026)",
        }, f)
    print(json.dumps({"rounds": rounds, "train_rows": len(train), "train_window": [months[0], months[TRAIN_END]],
                      "events_next_180d": {k: sorted({e["event"] for c in v.values() for e in c})
                                           for k, v in calendar.items()}}, indent=1))
    sys.exit(0)

test["pred_model"] = np.exp(test.level + model.predict(test[FEATS]))

# ---------- 3. Baselines (origin 2026-04) ----------
o = TRAIN_END
for idx, r in test.iterrows():
    i = keys.index((r.customer, r.category))
    hist = panel.values[i, :o + 1]
    t = int(r.target_month)
    test.at[idx, "pred_last"] = hist[-1]
    test.at[idx, "pred_mean6"] = hist[-6:].mean()
    test.at[idx, "pred_seasonal_naive"] = panel.values[i, t - 12]
    test.at[idx, "pred_level_x_season"] = np.exp(r.level + seas_arr[r.category][t])

# ---------- 4. Evaluation ----------
METHODS = ["pred_model", "pred_level_x_season", "pred_seasonal_naive", "pred_mean6", "pred_last"]
wape = lambda df, p: round(100 * float(np.abs(df.actual - df[p]).sum() / df.actual.sum()), 2)
tot = test.groupby(["customer", "target_month"])[["actual"] + METHODS].sum().reset_index()
sig = np.array([sigma.loc[c, h] for c, h in zip(test.category, test.h)])
lo = test.pred_model * np.exp(-1.645 * sig)
hi = test.pred_model * np.exp(1.645 * sig)
metrics = {
    "wape_pct_category_level": {m: wape(test, m) for m in METHODS},
    "wape_pct_household_total": {m: wape(tot, m) for m in METHODS},
    "wape_pct_by_category": {c: {m: wape(g, m) for m in METHODS} for c, g in test.groupby("category")},
    "wape_pct_by_horizon": {int(h): {m: wape(g, m) for m in METHODS} for h, g in test.groupby("h")},
    "coverage_90pct_band": round(float(((test.actual >= lo) & (test.actual <= hi)).mean()), 3),
    "feature_gain": dict(zip(FEATS, map(int, model.feature_importance("gain")))),
    "train_rows": len(train), "test_rows": len(test), "rounds": rounds,
}

# ---------- 5. Export ----------
model.save_model(str(OUT / "spend_model.txt"))
with open(OUT / "spend_model.json", "w") as f:
    json.dump({
        "model": model.dump_model(),
        "features": FEATS,
        "categories": CATS,
        "target": "log(category monthly spend) - trailing seasonally adjusted level",
        "seasonal_log_factors": seas,
        "residual_sigma_by_category_horizon": sigma.to_dict(orient="index"),
        "category_shares": shares.to_dict(orient="index"),
        "train_window": [months[0], months[TRAIN_END]],
        "rounds": rounds,
    }, f)
test.to_csv(OUT / "holdout_predictions.csv", index=False)
(OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
print(json.dumps({k: metrics[k] for k in ["wape_pct_category_level", "wape_pct_household_total",
                                          "wape_pct_by_category", "coverage_90pct_band",
                                          "feature_gain", "rounds"]}, indent=1))
