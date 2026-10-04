#!/usr/bin/env python3
"""GitHub Actions minutes budget for the refresh bot.   (stdlib only; reads .github/workflows/refresh.yml, no PyYAML needed)

  python tools/budget.py                  # check the workflow: runs/day, worst-case minutes in a 31-day month, OK / TOO MANY
  python tools/budget.py --suggest 2      # for B billed minutes per run: how many runs/day fit, and a ready-to-paste cron block
  python tools/budget.py --suggest 1      # e.g. if your Billing page shows runs bill only 1 minute: ~64 runs/day fit

The arithmetic:  runs/day = floor(1990 / 31 / B)   and   worst case = runs/day x B x 31   (<= 1990, allowance is 2000)"""
import re, os, sys, math

ALLOW = 1990
WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows", "refresh.yml")

def expand(field, lo, hi):
    out = set()
    for part in field.split(","):
        step = 1
        if "/" in part: part, st = part.split("/"); step = int(st)
        if part in ("*", ""): a, b = lo, hi
        elif "-" in part: a, b = map(int, part.split("-"))
        else: a = b = int(part)
        if part != "*" and "-" not in part and step != 1: b = hi
        if a > b: out |= set(range(a, hi + 1)) | set(range(lo, b + 1))
        else: out |= set(range(a, b + 1, step))
    return sorted(out)

def runs_from_cron(expr):
    m, h, dom, mon, dow = expr.split()
    assert dom == mon == dow == "*", "this checker only understands daily schedules"
    return [(hh, mm) for hh in expand(h, 0, 23) for mm in expand(m, 0, 59)]

def read_workflow():
    txt = open(WF).read()
    crons = re.findall(r'^\s*-\s*cron:\s*"([^"]+)"', txt, re.M)
    t = re.search(r"^\s*timeout-minutes:\s*(\d+)", txt, re.M)
    return crons, int(t.group(1)) if t else None

def check(quiet=False):
    crons, B = read_workflow()
    runs = sorted(set(r for c in crons for r in runs_from_cron(c)))
    n = len(runs)
    if quiet: return n * B * 31 <= ALLOW
    print(f"cron entries : {len(crons)}  -> {n} distinct runs per day (UTC)")
    print(f"billed/run B : {B} min (= timeout-minutes, the most one run can ever bill)")
    print(f"allowed      : floor({ALLOW} / 31 / {B}) = {ALLOW // 31 // B} runs/day")
    worst31 = n * B * 31
    print(f"worst case   : {n} x {B} x 31 = {worst31} min per 31-day month   (limit {ALLOW}, GitHub allowance 2000)  ->  {'OK' if worst31 <= ALLOW else 'TOO MANY RUNS'}")
    print(f"             : {n * B * 30} min in a 30-day month, {n * B * 28} in February")
    print("\nhour UTC  (ET summer)  runs")
    by = {}
    for hh, mm in runs: by.setdefault(hh, []).append(mm)
    for hh in range(24):
        ms = by.get(hh, [])
        et = (hh - 4) % 24
        print(f"  {hh:02d}      ({et:02d}:xx)   {len(ms)}  {' '.join(f':{m:02d}' for m in ms)}")
    return worst31 <= ALLOW

PRESETS = {   # hand-made shapes, all heavier in the US afternoon/evening; each is verified below against floor(1990/31/B)
    1: ['47 5,7,9,11,13 * * *', '17,47 14 * * *', '17 12 * * *', '7,22,37,52 15-23,0-4 * * *'],
    2: ['47 5,7,9,11,13 * * *', '37 15 * * *', '7,37 16-23,0-4 * * *'],
    3: ['47 5,9,13 * * *', '17 15-23,0-3 * * *', '47 17,19,21,23,1 * * *'],
    4: ['47 6,10,13 * * *', '27 15-23,0-3 * * *'],
}

def suggest(B):
    n = ALLOW // 31 // B
    if B not in PRESETS:
        print(f"B = {B}: {n} runs/day fit. No ready-made block; copy the closest one below and trim/extend its hour lists."); B = min(PRESETS, key=lambda k: abs(k - B)) if B > 0 else 2
    crons = PRESETS[B]
    got = len(set(r for c in crons for r in runs_from_cron(c)))
    print(f"B = {B} billed min/run  ->  {ALLOW // 31 // B} runs/day allowed, this block has {got} runs/day, worst case {got * B * 31} min per 31-day month\n")
    print("  schedule:"); [print(f'    - cron: "{c}"') for c in crons]
    print(f"\nAlso set  timeout-minutes: {B}  in .github/workflows/refresh.yml and LS_DEADLINE to about {B * 60 - 50} (seconds); then run `python tools/budget.py` to verify.")
    assert got <= ALLOW // 31 // B, "preset exceeds the budget"

if __name__ == "__main__":
    if "--suggest" in sys.argv:
        suggest(int(sys.argv[sys.argv.index("--suggest") + 1]))
    else:
        sys.exit(0 if check() else 1)
