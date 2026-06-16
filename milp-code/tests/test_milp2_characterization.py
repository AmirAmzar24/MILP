"""
Characterization (golden-master) suite for milp-code/milp2FINAL.py.

Purpose: freeze the engine's current behaviour as a safety net BEFORE the
refactor (Phases 1-4 of docs/MILP2_REFACTOR_PLAN.md). Each case feeds a raw MILP
payload into `callback(...)` and asserts the full output dict matches the golden
snapshot byte-for-byte (the solver is deterministic). Every refactor phase must
keep this suite GREEN; if a golden changes, the refactor is wrong — not the test.

Regenerate goldens (only when behaviour is *intentionally* changed):
    python milp-code/tests/generate_goldens.py
"""
import glob
import json
import os

import pytest

from _milp2_fixtures import CASES_DIR, call_callback, to_plain

# Exact match: the engine is deterministic, so any drift is a real regression.
ABS_TOL = 0.0


def _case_names():
    paths = sorted(glob.glob(os.path.join(CASES_DIR, "*.input.json")))
    return [os.path.basename(p)[: -len(".input.json")] for p in paths]


CASE_NAMES = _case_names()


def _load(name, suffix):
    with open(os.path.join(CASES_DIR, f"{name}.{suffix}.json")) as f:
        return json.load(f)


def _diffs(actual, expected, path=""):
    """Recursively collect human-readable mismatches between two JSON structures."""
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path}: type {type(actual).__name__} != dict"]
        out = []
        for k in expected.keys() - actual.keys():
            out.append(f"{path}.{k}: missing from output")
        for k in actual.keys() - expected.keys():
            out.append(f"{path}.{k}: unexpected extra key in output")
        for k in expected.keys() & actual.keys():
            out += _diffs(actual[k], expected[k], f"{path}.{k}")
        return out
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            return [f"{path}: list shape {_shape(actual)} != {_shape(expected)}"]
        out = []
        for i, (a, e) in enumerate(zip(actual, expected)):
            out += _diffs(a, e, f"{path}[{i}]")
        return out
    if isinstance(expected, bool) or isinstance(actual, bool):
        return [] if actual == expected else [f"{path}: {actual!r} != {expected!r}"]
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if abs(actual - expected) <= ABS_TOL:
            return []
        return [f"{path}: {actual!r} != {expected!r} (Δ={actual - expected:.3g})"]
    return [] if actual == expected else [f"{path}: {actual!r} != {expected!r}"]


def _shape(x):
    return f"list[{len(x)}]" if isinstance(x, list) else type(x).__name__


@pytest.fixture(scope="session", autouse=True)
def _require_cases():
    assert CASE_NAMES, (
        "No characterization cases found. Run: python milp-code/tests/generate_goldens.py"
    )


@pytest.mark.parametrize("case", CASE_NAMES)
def test_output_matches_golden(case):
    milp_input = _load(case, "input")
    golden = _load(case, "golden")
    actual = to_plain(call_callback(milp_input))

    diffs = _diffs(actual, golden)
    assert not diffs, "output drifted from golden:\n  " + "\n  ".join(diffs[:20])


@pytest.mark.parametrize("case", CASE_NAMES)
def test_output_keys_stable(case):
    """The set of output keys is part of the frozen contract (milp_to_gui reads them)."""
    golden = _load(case, "golden")
    actual = to_plain(call_callback(_load(case, "input")))
    assert set(actual.keys()) == set(golden.keys())
