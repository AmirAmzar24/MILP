"""
Regenerate golden snapshots for the `_rearrange_phases` characterization suite.

Run ONLY when _rearrange_phases' behaviour is intentionally changed:
    python milp-code/tests/generate_rearrange_goldens.py

Builds every (flag, pattern, group) case, calls _rearrange_phases, and writes
its four returned arrays to fixtures/rearrange_cases/<name>.golden.json.
"""
import json
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, THIS_DIR)                       # tests/ (for _*_fixtures)
sys.path.insert(0, os.path.join(THIS_DIR, ".."))   # milp-code/ (for milp2FINAL)

from _milp2_fixtures import to_plain
from _rearrange_fixtures import (
    CASES,
    REARRANGE_CASES_DIR,
    RESULT_KEYS,
    build_inputs,
    call_rearrange,
)


def main():
    os.makedirs(REARRANGE_CASES_DIR, exist_ok=True)
    for name, flag, pattern, group in CASES:
        out = call_rearrange(build_inputs(flag, pattern, group))
        golden = {k: to_plain(v) for k, v in zip(RESULT_KEYS, out)}
        path = os.path.join(REARRANGE_CASES_DIR, f"{name}.golden.json")
        with open(path, "w") as f:
            json.dump(golden, f, indent=2)
        print("wrote", os.path.basename(path))


if __name__ == "__main__":
    main()
