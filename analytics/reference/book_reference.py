"""Python reference implementation of the SpaceTime 360 book math (spec sections 1-3).

Independent of the TypeScript module; used to cross-check it. All money in integer cents.
Outputs reference.json: per customer -> snapshot, carry, monthly P&L.

Usage: python book_reference.py <data-dir> <out-json>
"""
import csv
import json
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

ASSETS = {"checking", "savings", "cd", "ira"}
LIQUID = {"checking", "savings"}
LOCKED = {"cd", "ira"}
DEBTS = {"credit_card", "auto_loan", "personal_loan", "mortgage"}
BUFFER_MONTHS = 3
HIGH_COST_APR = 10.0          # % APR at or above which debt is "high-cost" (actionable)


def c(x):
    return int((Decimal(x) * 100).to_integral_value())


def read(p):
    with p.open(newline="") as f:
        return list(csv.DictReader(f))


D = Path(sys.argv[1])
profiles = {r["customer_id"]: r for r in read(D / "profiles.csv")}
accounts = defaultdict(list)
for a in read(D / "accounts.csv"):
    accounts[a["customer_id"]].append(a)
stmts = defaultdict(list)
for s in read(D / "monthly_statements.csv"):
    stmts[s["customer_id"]].append(s)
txs = defaultdict(list)
for t in read(D / "transactions.csv"):
    txs[t["customer_id"]].append(t)


def status(v, good, warn, higher=True):
    if v is None:
        return "unknown"
    if not higher:
        v, good, warn = -v, -good, -warn
    return "good" if v >= good else "watch" if v >= warn else "risk"


out = {}
max_residual = 0
for cid, p in profiles.items():
    A = accounts[cid]
    bal = defaultdict(int)
    for a in A:
        bal[a["account_type"]] += c(a["balance"])
    income, nondebt = c(p["monthly_income"]), c(p["monthly_non_debt_expenses"])
    debt_pay = sum(c(a["monthly_payment"]) for a in A if a["account_type"] in DEBTS)
    outflow = nondebt + debt_pay
    liquid = sum(bal[k] for k in LIQUID)
    locked = sum(bal[k] for k in LOCKED)
    assets = sum(bal[k] for k in ASSETS)
    debts = sum(bal[k] for k in DEBTS)
    limit = c(p["credit_limit"])
    runway = liquid / outflow if outflow else None
    dti = debt_pay / income if income else None
    util = bal["credit_card"] / limit if limit else None
    srate = (income - outflow) / income if income else None
    snap = dict(net_worth=assets - debts, liquid=liquid, locked=locked, total_assets=assets,
                total_debt=debts, monthly_income=income, monthly_outflow=outflow,
                monthly_debt_payments=debt_pay, monthly_surplus=income - outflow,
                runway_months=runway, debt_to_income=dti, utilization=util, savings_rate=srate,
                status=dict(runway=status(runway, 6, 3), dti=status(dti, .20, .36, False),
                            utilization=status(util, .10, .30, False),
                            savings_rate=status(srate, .20, .10)))

    # ---- carry (annual, cents) ----
    earn = cost = structural = high_cost = 0
    lines = []
    for a in A:
        k = a["account_type"]
        b = c(a["balance"])
        if k in ASSETS:
            r = float(a["annual_yield_pct"])
            v = b * r / 100
            earn += v
        else:
            r = float(a["apr_pct"])
            v = -b * r / 100
            cost += -v
            if r >= HIGH_COST_APR:
                high_cost += v
            else:
                structural += v
        lines.append(dict(account_id=a["account_id"], type=k, balance=b, rate_pct=r, annual_carry=v))
    sav_yield = next((float(a["annual_yield_pct"]) for a in A if a["account_type"] == "savings"), 0.0)
    idle = max(0, liquid - BUFFER_MONTHS * outflow)
    # avalanche: idle cash retires high-cost debt, highest APR first
    leak, remaining, moves = 0.0, idle, []
    for a in sorted((a for a in A if a["account_type"] in DEBTS and float(a["apr_pct"]) >= HIGH_COST_APR),
                    key=lambda a: -float(a["apr_pct"])):
        amt = min(remaining, c(a["balance"]))
        if amt <= 0:
            break
        save = amt * (float(a["apr_pct"]) - sav_yield) / 100
        leak += save
        remaining -= amt
        moves.append(dict(account_id=a["account_id"], amount=amt, annual_saving=save))
    carry = dict(earn=earn, cost=cost, net=earn - cost, structural=structural, high_cost=high_cost,
                 idle_cash=idle, fixable_leak=leak, moves=moves, lines=lines)

    # ---- monthly P&L from the ledger ----
    S = stmts[cid]
    months = sorted({s["month"] for s in S})
    nw_close = {m: 0 for m in months}
    nw_open = {m: 0 for m in months}
    for s in S:
        sign = 1 if s["account_type"] in ASSETS else -1
        nw_close[s["month"]] += sign * c(s["closing_balance"])
        nw_open[s["month"]] += sign * c(s["opening_balance"])
    f = {m: defaultdict(int) for m in months}
    for t in txs[cid]:
        m, k, typ, amt = t["posted_date"][:7], t["account_type"], t["transaction_type"], c(t["amount"])
        if typ == "paycheck":
            f[m]["income"] += amt
        if t["flow_class"] == "expense":
            f[m]["spending"] += amt
        if typ == "interest_accrual":
            f[m]["asset_interest" if k in ASSETS else "debt_interest"] += amt
        if typ == "fee":
            f[m]["fees"] += amt
        if t["flow_class"] == "external_transfer":
            f[m]["ext_in" if c(t["balance_change"]) > 0 else "ext_out"] += amt
    pnl = []
    for m in months:
        x = f[m]
        dnw = nw_close[m] - nw_open[m]
        explained = (x["income"] - x["spending"] - x["debt_interest"] - x["fees"] + x["asset_interest"]
                     + x["ext_in"] - x["ext_out"])
        resid = dnw - explained
        max_residual = max(max_residual, abs(resid))
        pnl.append(dict(month=m, income=x["income"], spending=x["spending"], debt_interest=x["debt_interest"],
                        fees=x["fees"], asset_interest=x["asset_interest"], ext_in=x["ext_in"], ext_out=x["ext_out"],
                        delta_net_worth=dnw, organic=dnw - (x["ext_in"] - x["ext_out"]), residual=resid))
    out[cid] = dict(snapshot=snap, carry=carry, pnl=pnl)

Path(sys.argv[2]).write_text(json.dumps(out))
print("customers:", len(out), "| max |P&L residual| (cents):", max_residual)
c6 = out["C006"]
print("C006 snapshot:", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in c6["snapshot"].items()})
print("C006 carry:", {k: round(v, 2) if isinstance(v, float) else v for k, v in c6["carry"].items() if k not in ("lines",)})
tot = defaultdict(int)
for r in c6["pnl"]:
    for k, v in r.items():
        if k != "month":
            tot[k] += v
print("C006 24m P&L (cents):", dict(tot))
