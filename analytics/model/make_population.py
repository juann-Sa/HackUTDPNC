"""Grow the starter-kit population from 30 to 100 customers with distinct spending archetypes.

* C001-C030: copied unchanged from the kit snapshot; archetype "mainstream" (national pattern).
* C031-C100: new snapshot rows sampled with the kit's own rules (generate_data.py), new seed.
  10 more mainstream + 10 each of six non-mainstream archetypes.

Each customer's seasonal factor for category c, month m:
    f[c][m] = population[c][m] * archetype[c][m] * personal_jitter[c][m],
renormalized so each category averages 1 over the year (archetype changes timing, not level).
Ground truth goes to customer_archetypes.csv and customer_seasonal_factors.json; the model
must never read these (they are for evaluation only).

Usage: python make_population.py <kit-data-dir> <out-dir>
"""
import csv
import json
import random
import sys
from pathlib import Path

import numpy as np

KIT, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
POP = json.loads((Path(__file__).parent / "seasonal_factors.json").read_text())["monthly_factors"]
CATS = list(POP)

# Archetype multipliers on top of the national pattern: {category: {month: multiplier}} (ASSUMED).
ARCHETYPES = {
    "mainstream": {},
    "student": {          # tuition/books in Aug & Jan, home for summer, light December
        "other_spending": {8: 1.8, 1: 1.6},
        "shopping": {8: 1.6, 1: 1.4, 12: 0.8},
        "dining": {6: 0.7, 7: 0.7},
        "transport": {5: 1.3, 8: 1.3},
    },
    "no_holiday": {       # does not do holiday shopping/feasting: flatten Nov-Dec back to ~1
        "shopping": {11: 1 / POP["shopping"][10], 12: 1 / POP["shopping"][11]},
        "groceries": {11: 1 / POP["groceries"][10], 12: 1 / POP["groceries"][11]},
        "other_spending": {11: 1 / POP["other_spending"][10], 12: 1 / POP["other_spending"][11]},
        "dining": {12: 1 / POP["dining"][11]},
    },
    "annual_bills": {     # insurance premium in March, property tax in September
        "other_spending": {3: 3.5, 9: 2.5},
    },
    "winter_traveler": {  # travels Dec-Feb, home in summer
        "transport": {12: 1.5, 1: 1.5, 2: 1.5, 6: 0.8, 7: 0.8, 8: 0.8},
        "dining": {12: 1.3, 1: 1.3, 2: 1.3},
        "utilities": {1: 0.85, 2: 0.85},
    },
    "summer_family": {    # camps, road trips, eating out with kids in summer
        "dining": {6: 1.3, 7: 1.3, 8: 1.3},
        "transport": {6: 1.35, 7: 1.35, 8: 1.35},
        "shopping": {6: 1.2, 7: 1.2, 8: 1.2},
        "other_spending": {6: 1.5},
        "groceries": {6: 1.1, 7: 1.1, 8: 1.1},
    },
    "holiday_heavy": {    # goes big on the holidays
        "shopping": {11: 1.4, 12: 1.6},
        "dining": {12: 1.3},
        "groceries": {12: 1.15},
    },
}
NEW_ASSIGN = ["mainstream"] * 10 + [a for a in ARCHETYPES if a != "mainstream" for _ in range(10)]


def read(p):
    with p.open(newline="") as f:
        return list(csv.DictReader(f))


profiles = read(KIT / "profiles.csv")
kit_accounts = read(KIT / "accounts.csv")
base_cols = ["customer_id", "account_type", "balance", "monthly_payment", "apr_pct"]
accounts = [{k: a[k] for k in base_cols} for a in kit_accounts]

# New snapshot rows: same sampling rules as the kit's generate_data.py, different seed.
rng = random.Random(20261109)
order = list(NEW_ASSIGN)
rng.shuffle(order)
archetype = {p["customer_id"]: "mainstream" for p in profiles}
for j, i in enumerate(range(31, 101)):
    cid = f"C{i:03d}"
    archetype[cid] = order[j]
    income = round(rng.uniform(3500, 14500), 2)
    expenses = round(income * rng.uniform(.48, .94), 2)
    profiles.append(dict(customer_id=cid, monthly_income=income, monthly_non_debt_expenses=expenses,
                         credit_limit=round(rng.uniform(5000, 30000), 2)))
    for typ, lo, hi in [("checking", 300, 9000), ("savings", 1000, 28000), ("cd", 0, 14000),
                        ("ira", 1000, 85000), ("credit_card", 1000, 11000), ("auto_loan", 0, 30000),
                        ("personal_loan", 0, 14000), ("mortgage", 0, 330000)]:
        amount = round(rng.uniform(lo, hi), 2)
        if typ in ("cd", "auto_loan", "personal_loan", "mortgage") and rng.random() < .30:
            amount = 0
        payment, apr = 0, 0
        if typ == "credit_card":
            payment, apr = round(max(30, amount * .03), 2), 22.5
        elif typ == "auto_loan" and amount:
            payment, apr = round(amount / 48, 2), 7.5
        elif typ == "personal_loan" and amount:
            payment, apr = round(amount / 36, 2), 11.0
        elif typ == "mortgage" and amount:
            payment, apr = round(amount * .0065, 2), 6.5
        if amount:
            accounts.append(dict(customer_id=cid, account_type=typ, balance=amount,
                                 monthly_payment=payment, apr_pct=apr))

# Per-customer seasonal factors. Kit customers stay exactly on the population pattern so their
# history is identical to the 30-customer regeneration; new customers get a personal jitter.
nrng = np.random.default_rng(20261110)
factors = {}
for p in profiles:
    cid = p["customer_id"]
    arch = ARCHETYPES[archetype[cid]]
    new = int(cid[1:]) > 30
    f = {}
    for c in CATS:
        v = np.array(POP[c], dtype=float)
        for m, mult in arch.get(c, {}).items():
            v[m - 1] *= mult
        if new and c != "housing":
            v *= np.exp(nrng.normal(0, 0.03, 12))   # personal habit: ~3% month-shape jitter
        f[c] = list(np.round(v / v.mean(), 4))
    factors[cid] = f


def write(p, rows):
    with p.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


write(OUT / "profiles.csv", profiles)
write(OUT / "accounts.csv", accounts)
write(OUT / "customer_archetypes.csv", [{"customer_id": k, "archetype": v} for k, v in archetype.items()])
(OUT / "customer_seasonal_factors.json").write_text(json.dumps(factors))
counts = {}
for v in archetype.values():
    counts[v] = counts.get(v, 0) + 1
print(len(profiles), "customers,", len(accounts), "accounts;", counts)
