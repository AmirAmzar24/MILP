"""
Shared fixtures for the `_rearrange_phases` characterization suite.

Phase 3 of docs/MILP2_REFACTOR_PLAN.md rewrites `_rearrange_phases` into a
table-driven form. The milp2 golden suite only exercises the leading/lagging
patterns that real corridors produce — it does NOT cover the lead-lead (δ 0,0)
and lag-lag (δ 1,1) blocks (those need same-column coordination, which never
occurs in practice). Those blocks carry load-bearing quirks (lead-lead writes
no amber; flag==2 never ambers leftover phases; flat vs nested timing dicts).

This suite closes that blind spot by calling `_rearrange_phases` DIRECTLY with
crafted single-junction inputs that route to every (flag, pattern, group)
branch, and golden-masters the returned arrays. It is the safety net the Phase 3
rewrite must keep GREEN.

Regenerate goldens only when behaviour is *intentionally* changed:
    python milp-code/tests/generate_rearrange_goldens.py
"""
import os

import numpy as np

import milp2FINAL

REARRANGE_CASES_DIR = os.path.join(
    os.path.dirname(__file__), "fixtures", "rearrange_cases"
)

# Same NEMA ring-barrier pairing milp2 passes into _rearrange_phases.
RING_BARRIER = {1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7}

# group label -> (outbound phase id, inbound phase id). The pair is chosen so
# all four coordinated phases (out, ringBarrier[out], in, ringBarrier[in]) are
# distinct and the remaining four fill the other barrier cleanly.
_GROUPS = {
    "g12": (2, 6),
    "g56": (6, 2),
    "g34": (4, 8),
    "g78": (8, 4),
}

# pattern label -> (delta0, delta1) — the branch selector inside the function.
_PATTERNS = {
    "leading": (0, 1),
    "lagging": (1, 0),
    "leadlead": (0, 0),
    "laglag": (1, 1),
}


def build_inputs(flag, pattern, group):
    """Build a fresh single-junction input set routing to one branch.

    A full 8-phase NEMA junction (phaseID ring0=1..4, ring1=5..8) with distinct
    sentinel timings, so every ringBarrier lookup resolves and each value is
    traceable to the slot it lands in. Fresh arrays each call → deterministic and
    mutation-safe (the function copies its inputs, but we don't rely on that).
    """
    phaseID = np.array([[[1, 2, 3, 4], [5, 6, 7, 8]]], dtype=int)
    phasenew = np.array([[[11, 12, 13, 14], [15, 16, 17, 18]]], dtype=int)
    phaseRednew = np.array([[[21, 22, 23, 24], [25, 26, 27, 28]]], dtype=int)
    phaseAmbernew = np.array([[[31, 32, 33, 34], [35, 36, 37, 38]]], dtype=int)

    outbound_id, inbound_id = _GROUPS[group]
    d0, d1 = _PATTERNS[pattern]
    return dict(
        phaseID=phaseID,
        phasenew=phasenew,
        phaseRednew=phaseRednew,
        phaseAmbernew=phaseAmbernew,
        outbound=np.array([outbound_id]),
        inbound=np.array([inbound_id]),
        numberofjunctions=1,
        delta_new=np.array([[d0], [d1]]),
        flag=flag,
        ringBarrier=RING_BARRIER,
        outphase=np.array([101]),
        inphase=np.array([202]),
        outRed=np.array([303]),
        inRed=np.array([404]),
        outAmber=np.array([505]),
        inAmber=np.array([606]),
    )


def _enumerate_cases():
    """(name, flag, pattern, group) for every reachable branch."""
    cases = []
    # flag == 1 handles only leading / lagging.
    for pattern in ("leading", "lagging"):
        for group in ("g12", "g56", "g34", "g78"):
            cases.append((f"flag1_{pattern}_{group}", 1, pattern, group))
    # flag == 2 handles all four patterns (incl. the uncovered lead-lead/lag-lag).
    for pattern in ("leading", "lagging", "leadlead", "laglag"):
        for group in ("g12", "g56", "g34", "g78"):
            cases.append((f"flag2_{pattern}_{group}", 2, pattern, group))
    # flag == 0 rearranges nothing — freeze the passthrough.
    cases.append(("flag0_passthrough", 0, "leading", "g12"))
    return cases


CASES = _enumerate_cases()

# The four arrays _rearrange_phases returns, in order.
RESULT_KEYS = ["phaseID_new", "phasenewer", "phaseRednewer", "phaseAmbernewer"]


def call_rearrange(inputs):
    """Invoke _rearrange_phases in its frozen positional-arg order."""
    return milp2FINAL._rearrange_phases(
        inputs["phaseID"], inputs["phasenew"], inputs["phaseRednew"],
        inputs["phaseAmbernew"], inputs["outbound"], inputs["inbound"],
        inputs["numberofjunctions"], inputs["delta_new"], inputs["flag"],
        inputs["ringBarrier"], inputs["outphase"], inputs["inphase"],
        inputs["outRed"], inputs["inRed"], inputs["outAmber"], inputs["inAmber"],
    )
