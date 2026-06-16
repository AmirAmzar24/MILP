"""
Characterization (golden-master) suite for milp2FINAL._rearrange_phases.

Unit-level safety net for the Phase 3 table-driven rewrite. Unlike the milp2
golden suite (which only reaches leading/lagging via the solver), this calls
_rearrange_phases directly and covers ALL reachable branches — including the
lead-lead and lag-lag blocks that real corridors never produce. The Phase 3
rewrite must keep this GREEN; a drift here is a real regression.

Regenerate goldens (only when behaviour is *intentionally* changed):
    python milp-code/tests/generate_rearrange_goldens.py
"""
import json
import os

import pytest

from _milp2_fixtures import to_plain
from _rearrange_fixtures import (
    CASES,
    REARRANGE_CASES_DIR,
    RESULT_KEYS,
    build_inputs,
    call_rearrange,
)

_BY_NAME = {c[0]: c for c in CASES}
CASE_IDS = [c[0] for c in CASES]


def _load_golden(name):
    with open(os.path.join(REARRANGE_CASES_DIR, f"{name}.golden.json")) as f:
        return json.load(f)


@pytest.mark.parametrize("name", CASE_IDS)
def test_rearrange_matches_golden(name):
    _, flag, pattern, group = _BY_NAME[name]
    out = call_rearrange(build_inputs(flag, pattern, group))
    actual = {k: to_plain(v) for k, v in zip(RESULT_KEYS, out)}
    assert actual == _load_golden(name)
