"""
Regenerate the milp2FINAL characterization fixtures + golden outputs.

Run from anywhere:  python milp-code/tests/generate_goldens.py

Sourcing strategy
-----------------
`fixtures/inputs/*.json` are REAL, pristine MILP payloads — exactly what the
`/milp2` Postman route hands to `milp2FINAL.callback` (the 13 frozen args). We
feed them straight in (NO api_translator), snapshot the full output dict, and
write each case as a (input, golden) pair under `fixtures/cases/`.

Regimes the raw corridors don't cover (flag 0, flag 2, one-way suppressed) are
*derived* from a seed payload by a small, explicit transform — see REGIMES.
"""
import copy
import json
import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))  # milp-code/

from _milp2_fixtures import (  # noqa: E402
    CALLBACK_ARGS, CASES_DIR, SOURCE_DIR, call_callback, to_plain,
)


def load_payload(config_name: str) -> dict:
    """Load a raw MILP payload, keeping only the 13 frozen callback args."""
    with open(os.path.join(SOURCE_DIR, config_name)) as f:
        payload = json.load(f)
    return {name: to_plain(payload[name]) for name in CALLBACK_ARGS}


def set_flag(value):
    def _t(mi):
        mi = copy.deepcopy(mi)
        mi["flag"] = value
        return mi
    return _t


def _zero_direction(mi, direction_key):
    """Zero the green of each junction's coordination phase in `direction_key`
    ('outbound' or 'inbound'), so callback's one-way auto-detection fires."""
    mi = copy.deepcopy(mi)
    phase = mi["phase"]
    targets = mi[direction_key]
    for i, junction in enumerate(mi["phaseID"]):
        for ring, ids in enumerate(junction):
            for pos, pid in enumerate(ids):
                if pid == targets[i]:
                    phase[i][ring][pos] = 0
    return mi


def suppress_outbound(mi):
    return _zero_direction(mi, "outbound")


def suppress_inbound(mi):
    return _zero_direction(mi, "inbound")


def identity(mi):
    return copy.deepcopy(mi)


# (regime name, source payload, transform)
REGIMES = [
    # --- real corridors, flag 1, two-way ---
    ("corridor_2j",          "2-Junction-Config.json",          identity),
    ("corridor_3j",          "3-Junction-Config.json",          identity),
    ("corridor_4j",          "4-Junction-Config.json",          identity),
    ("tjunction_asymmetry",  "Tjunction-Asymmetry-Config.json", identity),
    # --- flag regimes (derived) ---
    ("flag0_2j",             "2-Junction-Config.json",          set_flag(0)),
    ("flag2_2j",             "2-Junction-Config.json",          set_flag(2)),
    ("flag2_4j",             "4-Junction-Config.json",          set_flag(2)),
    # --- one-way suppression (derived; auto-detected by callback) ---
    ("oneway_outbound_suppressed", "2-Junction-Config.json", suppress_outbound),
    ("oneway_inbound_suppressed",  "2-Junction-Config.json", suppress_inbound),
]


def main():
    os.makedirs(CASES_DIR, exist_ok=True)

    seed_cache = {}
    print(f"{'regime':<30} {'njunc':>5} {'flag':>4}  {'patterns':<14} {'keys':>4} {'det':>4}")
    print("-" * 70)
    for name, config, transform in REGIMES:
        if config not in seed_cache:
            seed_cache[config] = load_payload(config)
        milp_input = transform(seed_cache[config])

        output = to_plain(call_callback(milp_input))
        # determinism: an independent second call must match exactly.
        output2 = to_plain(call_callback(transform(seed_cache[config])))
        deterministic = json.dumps(output, sort_keys=True) == json.dumps(output2, sort_keys=True)

        with open(os.path.join(CASES_DIR, f"{name}.input.json"), "w") as f:
            json.dump(milp_input, f, indent=2)
        with open(os.path.join(CASES_DIR, f"{name}.golden.json"), "w") as f:
            json.dump(output, f, indent=2)

        patterns = sorted(str(v) for k, v in output.items() if k.endswith("pattern"))
        print(f"{name:<30} {len(milp_input['phase']):>5} {milp_input['flag']:>4}  "
              f"{','.join(patterns):<14} {len(output):>4} {str(deterministic):>4}")

    print("\nWrote (input, golden) pairs -> " + CASES_DIR)


if __name__ == "__main__":
    main()
