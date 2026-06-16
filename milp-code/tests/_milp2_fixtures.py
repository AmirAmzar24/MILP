"""
Shared helpers for the milp2FINAL characterization suite.

The characterization suite feeds RAW MILP payloads straight into
`milp2FINAL.callback` — exactly what the `/milp2` Postman route receives — so it
has zero dependency on api_translator. `fixtures/inputs/` holds the pristine
user-provided seed corridors; `generate_goldens.py` derives the per-regime cases
into `fixtures/cases/` and snapshots each output.
"""
import os

import numpy as np

import milp2FINAL

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
# Pristine, user-provided raw MILP payloads (the seed corridors).
SOURCE_DIR = os.path.join(FIXTURES_DIR, "inputs")
# Generated per-regime cases: each is a <name>.input.json (exact payload fed to
# callback) paired with a <name>.golden.json (snapshot of callback's output).
CASES_DIR = os.path.join(FIXTURES_DIR, "cases")

# Callback positional argument order (the frozen contract).
CALLBACK_ARGS = (
    "phase", "phaseID", "phaseRed", "phaseAmber", "outbound", "inbound",
    "queue_time", "k", "speedRange", "speedChangeRange", "distance",
    "cycleRange", "flag",
)


def to_plain(obj):
    """Recursively convert numpy scalars/arrays into JSON-native Python types.

    The callback returns a dict mixing plain ints/floats, numpy scalars
    (np.float64), and nested lists. Normalising makes snapshots stable and
    comparable regardless of which numeric type the engine happened to produce.
    """
    if isinstance(obj, dict):
        return {k: to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_plain(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return to_plain(obj.tolist())
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


def call_callback(milp_input: dict):
    """Invoke milp2FINAL.callback with a milp_input dict, in frozen arg order."""
    args = [milp_input[name] for name in CALLBACK_ARGS]
    return milp2FINAL.callback(*args)
