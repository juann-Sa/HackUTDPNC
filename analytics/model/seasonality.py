"""Calendar effects for synthetic spending.

1. Monthly seasonality per category from real Census retail sales (not seasonally adjusted).
   factor[m] = exp(median over years of log(x[year, m] / mean(x[year]))), renormalized to mean 1.
   Years 2015-2019 and 2022-2025; 2020-21 excluded (COVID distortion).
2. Within-month event timing (ASSUMED): which days of the month carry the spend.
   Events redistribute a category's monthly total across days; they never change the total,
   so they cannot double-count the Census monthly seasonality.

Usage: python seasonality.py <external-dir> <out-json>
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

YEARS = [2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025]

# Kit category -> Census series (summed in dollars when several).
SOURCES = {
    "dining": ["MRTSSM722USN"],                       # food services & drinking places
    "groceries": ["MRTSSM4451USN"],                   # grocery stores
    "transport": ["MRTSSM447USN"],                    # gasoline stations
    "shopping": ["MRTSSM452USN", "MRTSSM448USN"],     # general merchandise + clothing
    "other_spending": ["MRTSSM44Y72USN"],             # all retail & food services ex autos
}
# ASSUMED: residential utility bills peak with summer cooling and winter heating.
UTILITIES_ASSUMED = [1.08, 1.02, 0.92, 0.88, 0.95, 1.08, 1.18, 1.20, 1.05, 0.90, 0.88, 1.00]
# Rent/mortgage-style housing payments do not vary by season.
HOUSING = [1.0] * 12


def load(ext, series):
    out = {}
    for line in (ext / f"{series}.txt").read_text().splitlines():
        if line and not line.startswith("#"):
            ym, v = line.split()
            out[(int(ym[:4]), int(ym[5:]))] = float(v)
    return out


def monthly_factors(ext):
    factors = {}
    for cat, series in SOURCES.items():
        data = [load(ext, s) for s in series]
        logs = []
        for y in YEARS:
            x = np.array([sum(d[(y, m)] for d in data) for m in range(1, 13)])
            logs.append(np.log(x / x.mean()))
        f = np.exp(np.median(np.array(logs), axis=0))
        factors[cat] = list(np.round(f / f.mean(), 4))
    u = np.array(UTILITIES_ASSUMED)
    factors["utilities"] = list(np.round(u / u.mean(), 4))
    factors["housing"] = HOUSING
    return factors


# ---------------- within-month events (ASSUMED) ----------------
def nth_weekday(y, m, weekday, n):
    """n-th given weekday (Mon=0) of month; n=-1 means last."""
    if n > 0:
        d = date(y, m, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    d = nxt - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def events_for(y, m):
    """Return {category: [(day, share_of_month), ...]} for event-driven spend in month (y, m).
    Shares are the fraction of that category's monthly total posted on that day (assumed)."""
    ev = {}
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    add = lambda c, d, s, name: ev.setdefault(c, []).append((min(max(d, 1), last), s, name))
    if m == 2:
        add("dining", 14, 0.30, "Valentine's Day")
        add("shopping", 13, 0.15, "Valentine's gifts")
        add("groceries", nth_weekday(y, 2, 6, 2).day - 1, 0.12, "Super Bowl weekend")
    if m == 5:
        add("dining", nth_weekday(y, 5, 6, 2).day, 0.20, "Mother's Day")
        add("shopping", nth_weekday(y, 5, 6, 2).day - 2, 0.10, "Mother's Day gifts")
        add("transport", nth_weekday(y, 5, 0, -1).day - 3, 0.15, "Memorial Day travel")
    if m == 6:
        add("dining", nth_weekday(y, 6, 6, 3).day, 0.15, "Father's Day")
    if m == 7:
        add("groceries", 3, 0.20, "July 4th cookout")
        add("transport", 2, 0.15, "July 4th travel")
        add("shopping", 25, 0.20, "Back-to-school")
    if m == 8:
        add("shopping", 8, 0.30, "Back-to-school")
        add("shopping", 15, 0.15, "Back-to-school")
    if m == 9:
        add("transport", nth_weekday(y, 9, 0, 1).day - 3, 0.12, "Labor Day travel")
    if m == 11:
        thanksgiving = nth_weekday(y, 11, 3, 4)
        add("groceries", thanksgiving.day - 2, 0.25, "Thanksgiving groceries")
        add("transport", thanksgiving.day - 1, 0.15, "Thanksgiving travel")
        add("shopping", thanksgiving.day + 1, 0.30, "Black Friday")
        bf = thanksgiving + timedelta(days=4)
        if bf.month == 11:
            add("shopping", bf.day, 0.15, "Cyber Monday")
    if m == 12:
        add("shopping", 1 if nth_weekday(y, 11, 3, 4).day + 4 > 30 else 7, 0.10, "Cyber Week / early gifts")
        add("shopping", 15, 0.25, "Holiday gifts")
        add("shopping", 21, 0.30, "Last-minute gifts")
        add("groceries", 23, 0.25, "Holiday meals")
        add("transport", 22, 0.15, "Holiday travel")
        add("dining", 31, 0.12, "New Year's Eve")
    return ev


def main():
    ext, out = Path(sys.argv[1]), Path(sys.argv[2])
    factors = monthly_factors(ext)
    example = {f"{y}-{m:02d}": {c: [(d, s, n) for d, s, n in v] for c, v in events_for(y, m).items()}
               for y in (2025, 2026) for m in range(1, 13) if events_for(y, m)}
    out.write_text(json.dumps({
        "monthly_factors": factors,
        "monthly_factor_source": {**{c: s for c, s in SOURCES.items()},
                                  "utilities": "ASSUMED summer/winter pattern",
                                  "housing": "flat (fixed payments)"},
        "years_used": YEARS,
        "events_assumed": example,
    }, indent=1))
    print("month:      " + " ".join(f"{m:>5}" for m in range(1, 13)))
    for c, f in factors.items():
        print(f"{c:<14}" + " ".join(f"{v:5.2f}" for v in f))


if __name__ == "__main__":
    main()
