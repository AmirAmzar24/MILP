"""
Regression tests for api_translator.py.

Purpose: capture current behaviour as a safety net before the module is split
into sub-modules (overlap_detection, phase_rearrangement, nema_builder,
cycle_standardization). Every test here must stay GREEN throughout the split.
"""

import json
import os
import pytest

from api_translator import (
    gui_to_milp,
    milp_to_gui,
    detect_overlap_positions,
    detect_asymmetric_barriers,
    rearrange_phases_for_coordination,
    build_nema_structure,
    standardize_cycle_lengths,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def load_fixture(name: str) -> dict:
    with open(os.path.join(FIXTURES_DIR, name)) as f:
        return json.load(f)


def make_passthrough_milp_output(milp_input: dict, num_junctions: int) -> dict:
    """
    Build a minimal MILP output that mirrors the MILP input phase structure.
    Simulates 'solver returned the same phases unchanged' so milp_to_gui can
    reconstruct the GUI format without a real solver.
    """
    cycle = sum(milp_input["phase"][0][0])
    out = {
        "NewCycle": cycle,
        "Outbound_bandwidth_actual": cycle // 3,
        "Inbound_bandwidth_actual": cycle // 3,
        "Phase": milp_input["phase"],
        "Phase_ID": milp_input["phaseID"],
    }
    for i in range(num_junctions):
        out[f"offset_{i}"] = 0
    for i in range(num_junctions - 1):
        out[f"Time_Outbound{i+1}-{i+2}"] = 15
        out[f"Time_Inbound{i+1}-{i+2}"] = 15
    return out


# ---------------------------------------------------------------------------
# TRACER BULLET: gui_to_milp runs on 4-phase fixture
# ---------------------------------------------------------------------------

def test_gui_to_milp_runs_on_4phase_fixture():
    fixture = load_fixture("fixture_4phase.json")
    result = gui_to_milp(fixture)
    assert result is not None


# ---------------------------------------------------------------------------
# gui_to_milp: output structure
# ---------------------------------------------------------------------------

class TestGuiToMilpStructure:
    """gui_to_milp must always return a valid MILP input dict."""

    def test_required_keys_present(self):
        fixture = load_fixture("fixture_4phase.json")
        result = gui_to_milp(fixture)
        for key in ("phase", "phaseID", "phaseRed", "phaseAmber",
                    "outbound", "inbound", "queue_time", "k",
                    "speedRange", "speedChangeRange", "distance",
                    "cycleRange", "flag"):
            assert key in result, f"Missing key: {key}"

    def test_phase_is_2_rings_4_positions_per_junction(self):
        fixture = load_fixture("fixture_4phase.json")
        result = gui_to_milp(fixture)
        n = len(fixture["junctions"])
        assert len(result["phase"]) == n
        for j in range(n):
            assert len(result["phase"][j]) == 2, "Each junction must have 2 rings"
            for ring in result["phase"][j]:
                assert len(ring) == 4, "Each ring must have 4 positions"

    def test_all_phase_durations_are_non_negative(self):
        fixture = load_fixture("fixture_4phase.json")
        result = gui_to_milp(fixture)
        for junction_phases in result["phase"]:
            for ring in junction_phases:
                for duration in ring:
                    assert duration >= 0

    def test_outbound_inbound_are_valid_nema_ids(self):
        fixture = load_fixture("fixture_4phase.json")
        result = gui_to_milp(fixture)
        valid_nema_ids = {1, 2, 3, 4, 5, 6, 7, 8}
        for nema_id in result["outbound"]:
            assert nema_id in valid_nema_ids
        for nema_id in result["inbound"]:
            assert nema_id in valid_nema_ids

    def test_outbound_uses_ring1_inbound_uses_ring0(self):
        # ADR-0001: GUI outbound → MILP Ring 1 (IDs 6,5,8,7)
        #           GUI inbound  → MILP Ring 0 (IDs 1,2,3,4)
        fixture = load_fixture("fixture_4phase.json")
        result = gui_to_milp(fixture)
        ring1_ids = {5, 6, 7, 8}
        ring0_ids = {1, 2, 3, 4}
        for nema_id in result["outbound"]:
            assert nema_id in ring1_ids, f"Outbound NEMA ID {nema_id} not in Ring 1"
        for nema_id in result["inbound"]:
            assert nema_id in ring0_ids, f"Inbound NEMA ID {nema_id} not in Ring 0"

    def test_raises_for_single_junction(self):
        fixture = load_fixture("fixture_4phase.json")
        fixture["junctions"] = fixture["junctions"][:1]
        with pytest.raises(ValueError, match="At least 2 junctions"):
            gui_to_milp(fixture)


# ---------------------------------------------------------------------------
# detect_overlap_positions
# ---------------------------------------------------------------------------

class TestDetectOverlapPositions:

    def test_4phase_no_ovl_returns_empty(self):
        junction = {"ovlPhaseIndices": [], "outboundIdx": [0], "inboundIdx": [1]}
        assert detect_overlap_positions(junction) == []

    def test_5phase_single_ovl_at_index_1(self):
        junction = {"ovlPhaseIndices": [1], "outboundIdx": [0], "inboundIdx": [2]}
        assert detect_overlap_positions(junction) == [1]

    def test_6phase_two_ovl_at_indices_1_and_4(self):
        junction = {"ovlPhaseIndices": [1, 4], "outboundIdx": [0], "inboundIdx": [2]}
        assert detect_overlap_positions(junction) == [1, 4]

    def test_result_is_always_sorted(self):
        junction = {"ovlPhaseIndices": [4, 1], "outboundIdx": [0], "inboundIdx": [2]}
        assert detect_overlap_positions(junction) == [1, 4]

    def test_fallback_uses_inbound_outbound_intersection_when_field_missing(self):
        # Old data without ovlPhaseIndices: falls back to intersection heuristic
        junction = {"outboundIdx": [0, 1], "inboundIdx": [1, 2]}
        result = detect_overlap_positions(junction)
        assert result == [1]  # index 1 is in both sets


# ---------------------------------------------------------------------------
# detect_asymmetric_barriers
# ---------------------------------------------------------------------------

class TestDetectAsymmetricBarriers:

    def _sym_junction(self):
        """Symmetric 4-phase junction — no asymmetry."""
        return {
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [0],
            "inboundIdx": [1],
            "ovlPhaseIndices": [],
        }

    def _asym_outbound_junction(self):
        """
        Barrier 0 asymmetric outbound:
          phase 0 = outbound-only (exclusive / merge_at)
          phase 1 = bridge (both outbound AND inbound)
        """
        return {
            "phases_s": [20, 40, 30, 20],
            "outboundIdx": [0, 1],
            "inboundIdx": [1, 3],
            "ovlPhaseIndices": [],
        }

    def test_symmetric_junction_returns_empty(self):
        j = self._sym_junction()
        result = detect_asymmetric_barriers(j, [])
        assert result == []

    def test_asymmetric_outbound_detected(self):
        j = self._asym_outbound_junction()
        result = detect_asymmetric_barriers(j, [])
        assert len(result) == 1
        asym = result[0]
        assert asym["barrier"] == 0
        assert asym["dir"] == "out"
        assert asym["merge_at"] == 0
        assert asym["bridge"] == 1

    def test_asymmetric_inbound_detected(self):
        """
        Barrier 0 asymmetric inbound:
          phase 0 = inbound-only (exclusive / merge_at)
          phase 1 = bridge (both inbound AND outbound)
        """
        j = {
            "phases_s": [20, 40, 30, 20],
            "outboundIdx": [1, 2],
            "inboundIdx": [0, 1],
            "ovlPhaseIndices": [],
        }
        result = detect_asymmetric_barriers(j, [])
        assert len(result) == 1
        asym = result[0]
        assert asym["dir"] == "in"
        assert asym["merge_at"] == 0
        assert asym["bridge"] == 1

    def test_ovl_phases_excluded_from_asymmetry_check(self):
        # Barrier 0 contains an OVL phase — should be skipped entirely
        j = {
            "phases_s": [20, 10, 30, 20],
            "outboundIdx": [0, 1],
            "inboundIdx": [1, 3],
            "ovlPhaseIndices": [1],
        }
        result = detect_asymmetric_barriers(j, [1])
        # Barrier 0 (phases 0,1) contains OVL at index 1 — must be skipped
        assert not any(a["barrier"] == 0 for a in result)


# ---------------------------------------------------------------------------
# rearrange_phases_for_coordination
# ---------------------------------------------------------------------------

class TestRearrangePhases:

    def test_no_rearrangement_needed_when_coordination_already_at_0_1(self):
        # outbound at 0, inbound at 1 → already correct
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4"],
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [0],
            "inboundIdx": [1],
            "ovlPhaseIndices": [],
        }
        needs, result, mapping = rearrange_phases_for_coordination(junction)
        assert needs is False
        assert result["phaseNames"] == ["A1", "A2", "A3", "A4"]
        assert mapping == [0, 1, 2, 3]

    def test_rearrangement_moves_coordination_to_positions_0_and_1(self):
        # outbound at 2, inbound at 3 → requires rotation
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4"],
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [2],
            "inboundIdx": [3],
            "ovlPhaseIndices": [],
        }
        needs, result, mapping = rearrange_phases_for_coordination(junction)
        assert needs is True
        # After rearrangement the first outbound index must be 0
        assert result["outboundIdx"][0] == 0

    def test_phase_count_unchanged_after_rearrangement(self):
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4"],
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [2],
            "inboundIdx": [3],
            "ovlPhaseIndices": [],
        }
        _, result, _ = rearrange_phases_for_coordination(junction)
        assert len(result["phases_s"]) == 4
        assert len(result["phaseNames"]) == 4

    def test_cycle_length_preserved_after_rearrangement(self):
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4"],
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [2],
            "inboundIdx": [3],
            "ovlPhaseIndices": [],
        }
        _, result, _ = rearrange_phases_for_coordination(junction)
        assert sum(result["phases_s"]) == sum([30, 20, 25, 15])

    def test_reverse_mapping_length_matches_phase_count(self):
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4"],
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [2],
            "inboundIdx": [3],
            "ovlPhaseIndices": [],
        }
        _, result, mapping = rearrange_phases_for_coordination(junction)
        assert len(mapping) == 4

    def test_5phase_ovl_coordination_at_positions_0_and_1(self):
        # 5-phase: OVL at index 1. outbound=0, inbound=2. Already at logical 0,1.
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4", "A5"],
            "phases_s": [30, 10, 20, 25, 15],
            "outboundIdx": [0],
            "inboundIdx": [2],
            "ovlPhaseIndices": [1],
        }
        needs, result, _ = rearrange_phases_for_coordination(junction)
        assert needs is False  # already at logical positions 0,1 (skipping OVL)

    def test_6phase_ovl_coordination_at_positions_0_and_1(self):
        # 6-phase: OVL at indices 1 and 4. outbound=0, inbound=2.
        junction = {
            "phaseNames": ["A1", "A2", "A3", "A4", "A5", "A6"],
            "phases_s": [30, 10, 20, 15, 8, 17],
            "outboundIdx": [0],
            "inboundIdx": [2],
            "ovlPhaseIndices": [1, 4],
        }
        needs, result, _ = rearrange_phases_for_coordination(junction)
        assert needs is False


# ---------------------------------------------------------------------------
# build_nema_structure
# ---------------------------------------------------------------------------

class TestBuildNemaStructure:

    OPT_CONFIG = {"defaultAmber_s": 3, "defaultRed_s": 2}

    def _4phase_junction(self):
        return {
            "phases_s": [30, 20, 25, 15],
            "outboundIdx": [0],
            "inboundIdx": [1],
            "ovlPhaseIndices": [],
            "phaseNames": ["A1", "A2", "A3", "A4"],
        }

    def test_output_is_4_arrays(self):
        junctions = [self._4phase_junction(), self._4phase_junction()]
        result = build_nema_structure(junctions, self.OPT_CONFIG)
        assert len(result) == 4  # (phase, phaseID, phaseRed, phaseAmber)

    def test_each_junction_has_2_rings(self):
        junctions = [self._4phase_junction(), self._4phase_junction()]
        phase, phaseID, phaseRed, phaseAmber = build_nema_structure(junctions, self.OPT_CONFIG)
        for j in range(2):
            assert len(phase[j]) == 2
            assert len(phaseID[j]) == 2

    def test_each_ring_has_4_positions(self):
        junctions = [self._4phase_junction(), self._4phase_junction()]
        phase, phaseID, _, _ = build_nema_structure(junctions, self.OPT_CONFIG)
        for j in range(2):
            for ring in phase[j]:
                assert len(ring) == 4
            for ring in phaseID[j]:
                assert len(ring) == 4

    def test_standard_nema_ids_assigned(self):
        junctions = [self._4phase_junction()]
        _, phaseID, _, _ = build_nema_structure(junctions, self.OPT_CONFIG)
        assert phaseID[0][0] == [1, 2, 3, 4]
        assert phaseID[0][1] == [6, 5, 8, 7]

    def test_all_phase_durations_non_negative(self):
        junctions = [self._4phase_junction(), self._4phase_junction()]
        phase, _, _, _ = build_nema_structure(junctions, self.OPT_CONFIG)
        for j in range(2):
            for ring in phase[j]:
                for d in ring:
                    assert d >= 0

    def test_5phase_ovl_ring_durations_differ(self):
        # OVL adds its time to ring0 position after, ring1 position before
        junction = {
            "phases_s": [30, 10, 20, 25, 15],
            "outboundIdx": [0],
            "inboundIdx": [2],
            "ovlPhaseIndices": [1],
            "phaseNames": ["A1", "A2", "A3", "A4", "A5"],
        }
        phase, _, _, _ = build_nema_structure([junction, junction], self.OPT_CONFIG)
        # With OVL at index 1: ring0 and ring1 must differ at barrier-1 positions
        assert phase[0][0] != phase[0][1]


# ---------------------------------------------------------------------------
# standardize_cycle_lengths
# ---------------------------------------------------------------------------

class TestStandardizeCycleLengths:

    def _two_junction_fixture(self, c1, c2):
        """Build a minimal 2-junction fixture with given cycle lengths."""
        def make_j(jid, phases):
            return {
                "id": jid, "name": jid, "position_m": 0,
                "offset_s": 0, "phases_s": phases,
                "outboundIdx": [0], "inboundIdx": [1],
                "ovlPhaseIndices": [],
            }
        # c1 = [p1a, p1b]; c2 = [p2a, p2b]
        return {
            "junctions": [make_j("j1", c1), make_j("j2", c2)],
            "queueOut_s": [5, 5],
            "queueIn_s": [5, 5],
            "optimization": {},
        }

    def test_equal_cycles_unchanged(self):
        fixture = self._two_junction_fixture([45, 45], [45, 45])
        result = standardize_cycle_lengths(fixture)
        assert result["junctions"][0]["phases_s"] == [45, 45]
        assert result["junctions"][1]["phases_s"] == [45, 45]

    def test_cycles_equalized_to_integer_average(self):
        # J1 = 80, J2 = 100 → target average = 90
        fixture = self._two_junction_fixture([40, 40], [50, 50])
        result = standardize_cycle_lengths(fixture)
        c1 = sum(result["junctions"][0]["phases_s"])
        c2 = sum(result["junctions"][1]["phases_s"])
        assert c1 == 90
        assert c2 == 90

    def test_phase_sum_equals_average_after_standardization(self):
        fixture = self._two_junction_fixture([30, 20, 25, 15], [35, 25, 20, 10])
        result = standardize_cycle_lengths(fixture)
        avg_target = sum(result["junctions"][0]["phases_s"])
        for j in result["junctions"]:
            assert sum(j["phases_s"]) == avg_target

    def test_original_not_mutated(self):
        fixture = self._two_junction_fixture([40, 40], [50, 50])
        original_phases = list(fixture["junctions"][0]["phases_s"])
        standardize_cycle_lengths(fixture)
        assert fixture["junctions"][0]["phases_s"] == original_phases

    def test_single_junction_returned_unchanged(self):
        # Standardization requires ≥2 junctions; 1-junction input passes through
        fixture = {
            "junctions": [{"phases_s": [30, 20, 25, 15], "id": "j1"}],
            "queueOut_s": [5], "queueIn_s": [5], "optimization": {},
        }
        result = standardize_cycle_lengths(fixture)
        assert result["junctions"][0]["phases_s"] == [30, 20, 25, 15]


# ---------------------------------------------------------------------------
# Round-trip integration: gui_to_milp → milp_to_gui
# ---------------------------------------------------------------------------

ALL_FIXTURES = [
    "fixture_4phase.json",
    "fixture_5phase_ovl.json",
    "fixture_6phase_ovl.json",
    "fixture_asymmetric.json",
    "fixture_corridor_3j.json",
]


class TestRoundTrip:
    """
    gui_to_milp → (pass-through MILP output) → milp_to_gui must preserve the
    structural invariants of the original GUI input.
    """

    @pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
    def test_gui_to_milp_produces_valid_structure(self, fixture_name):
        fixture = load_fixture(fixture_name)
        milp_input = gui_to_milp(fixture)
        n = len(fixture["junctions"])
        assert len(milp_input["phase"]) == n
        for j in range(n):
            assert len(milp_input["phase"][j]) == 2
            for ring in milp_input["phase"][j]:
                assert len(ring) == 4

    @pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
    def test_round_trip_preserves_junction_count(self, fixture_name):
        fixture = load_fixture(fixture_name)
        milp_input = gui_to_milp(fixture)
        n = len(fixture["junctions"])
        milp_output = make_passthrough_milp_output(milp_input, n)
        result = milp_to_gui(milp_output, fixture, milp_input)
        assert len(result["junctions"]) == n

    @pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
    def test_round_trip_preserves_phase_count_per_junction(self, fixture_name):
        fixture = load_fixture(fixture_name)
        milp_input = gui_to_milp(fixture)
        n = len(fixture["junctions"])
        milp_output = make_passthrough_milp_output(milp_input, n)
        result = milp_to_gui(milp_output, fixture, milp_input)
        for i, orig_j in enumerate(fixture["junctions"]):
            result_j = result["junctions"][i]
            assert len(result_j["phases_s"]) == len(orig_j["phases_s"]), (
                f"Junction {i} in {fixture_name}: phase count changed "
                f"({len(orig_j['phases_s'])} → {len(result_j['phases_s'])})"
            )

    @pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
    def test_round_trip_cycle_length_preserved_within_tolerance(self, fixture_name):
        fixture = load_fixture(fixture_name)
        milp_input = gui_to_milp(fixture)
        # Use standardized fixture cycle as the reference (what was actually sent to MILP)
        from api_translator import standardize_cycle_lengths
        std_fixture = standardize_cycle_lengths(fixture)
        n = len(fixture["junctions"])
        milp_output = make_passthrough_milp_output(milp_input, n)
        result = milp_to_gui(milp_output, fixture, milp_input)
        for i, std_j in enumerate(std_fixture["junctions"]):
            expected_cycle = sum(std_j["phases_s"])
            result_cycle = sum(result["junctions"][i]["phases_s"])
            assert abs(result_cycle - expected_cycle) <= 1, (
                f"Junction {i} in {fixture_name}: cycle drifted "
                f"(expected {expected_cycle}, got {result_cycle})"
            )

    @pytest.mark.parametrize("fixture_name", ALL_FIXTURES)
    def test_round_trip_outbound_inbound_count_preserved(self, fixture_name):
        fixture = load_fixture(fixture_name)
        milp_input = gui_to_milp(fixture)
        n = len(fixture["junctions"])
        milp_output = make_passthrough_milp_output(milp_input, n)
        result = milp_to_gui(milp_output, fixture, milp_input)
        for i, orig_j in enumerate(fixture["junctions"]):
            result_j = result["junctions"][i]
            assert len(result_j.get("outboundIdx", [])) >= 1, (
                f"Junction {i} in {fixture_name}: outboundIdx empty after round-trip"
            )
            assert len(result_j.get("inboundIdx", [])) >= 1, (
                f"Junction {i} in {fixture_name}: inboundIdx empty after round-trip"
            )
