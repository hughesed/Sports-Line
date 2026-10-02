"""Compare the key structure of two JSON files (old reference vs new output).  usage: schema_diff.py old.json new.json
Prints key paths present in one but not the other (lists are merged element-wise, so optional keys that only some games have are shown as 'optional')."""
import json, sys, collections
def paths(o, pre="", out=None):
    out = out if out is not None else collections.defaultdict(set)
    if isinstance(o, dict):
        for k, v in o.items():
            p = f"{pre}.{k}" if not (pre.endswith("[]") and False) else k
            out[p].add(type(v).__name__ if not isinstance(v, (dict, list)) else ("dict" if isinstance(v, dict) else "list")); paths(v, p, out)
    elif isinstance(o, list):
        for v in o: paths(v, pre + "[]", out)
    return out
def norm(p):
    import re
    return re.sub(r"\.\d{4,}|\.[A-Z]{2,4}(?=\.|$)", ".*", p)
def run(a, b):
    A = paths(json.load(open(a))); B = paths(json.load(open(b)))
    def group(P):
        g = collections.defaultdict(set)
        for k, v in P.items(): g[norm(k)] |= v
        return g
    A, B = group(A), group(B)
    only_a = sorted(set(A) - set(B)); only_b = sorted(set(B) - set(A))
    tdiff = sorted((k, A[k], B[k]) for k in set(A) & set(B) if A[k] != B[k] and not ({"NoneType"} >= (A[k] ^ B[k]) or {"int", "float"} >= (A[k] | B[k])))
    return only_a, only_b, tdiff
if __name__ == "__main__":
    oa, ob, td = run(sys.argv[1], sys.argv[2])
    print("only in OLD:", *oa[:60], sep="\n  "); print("only in NEW:", *ob[:60], sep="\n  "); print("type differences:", *td[:40], sep="\n  ")
    sys.exit(1 if (oa or ob) and "--strict" in sys.argv else 0)
