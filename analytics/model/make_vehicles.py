"""Synthetic Toyota vehicles for the "Car loans" tab (Toyota Financial Services challenge).

One vehicle per existing auto loan, so the car always matches the loan payments already in the ledger.
Everything here is SYNTHETIC and documented; nothing is a real Toyota price, rate or valuation.

  model        list price nearest to the estimated original price (opening balance / 0.8, i.e. 20% down)
  model_year   older when more of the original loan has been repaid
  mileage      ~12,000 mi/year +/- 20%
  trade_in     estimate: price x 0.85^age, minus $0.10 per mile above 12,000/year (floored at 15% of price)
  new_price    same model, current model year: price x 1.03^age
  refi_apr     synthetic refinance offer, 5.49% APR
  new_car_apr  synthetic new-vehicle financing offer, 6.49% APR for 60 months

Usage: python make_vehicles.py <data-dir>
"""
import csv
import random
import sys
from pathlib import Path

D = Path(sys.argv[1])
LIST = [  # synthetic list prices (dollars)
    ("Corolla", 23_000), ("Prius", 29_000), ("Camry", 29_500), ("RAV4", 31_000),
    ("Tacoma", 33_000), ("Highlander", 41_000), ("4Runner", 42_000), ("Tundra", 45_000),
]
CURRENT_YEAR, REFI_APR, NEW_APR, NEW_TERM = 2027, 5.49, 6.49, 60
rng = random.Random(20261108)
rows = []
for a in csv.DictReader((D / "accounts.csv").open()):
    if a["account_type"] != "auto_loan":
        continue
    opening, balance = float(a["opening_balance"]), float(a["balance"])
    est_price = max(opening / 0.8, 18_000)
    model, price = min(LIST, key=lambda m: abs(m[1] - est_price))
    repaid = 1 - min(1.0, opening / (price * 0.8))  # share of the original loan already paid at history start
    age = min(8, 2 + round(4 * repaid) + rng.randint(0, 1))  # years old as of the data's end (Oct 2026)
    year = 2026 - age
    miles = round(12_000 * age * rng.uniform(0.8, 1.2), -2)
    trade = price * 0.85 ** age - 0.10 * max(0, miles - 12_000 * age)
    trade = max(trade, 0.15 * price)
    rows.append(dict(
        vehicle_id=f"V-{a['customer_id']}", customer_id=a["customer_id"], account_id=a["account_id"],
        make="Toyota", model=model, model_year=year, mileage=int(miles),
        list_price=f"{price:.2f}", trade_in_estimate=f"{round(trade, -1):.2f}",
        new_model_year=CURRENT_YEAR, new_price=f"{round(price * 1.03 ** age, -1):.2f}",
        refi_apr_pct=REFI_APR, new_car_apr_pct=NEW_APR, new_car_term_months=NEW_TERM,
    ))
with (D / "vehicles.csv").open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
print(len(rows), "vehicles;", sorted({r["model"] for r in rows}))
for r in rows[:5]:
    print(r)
