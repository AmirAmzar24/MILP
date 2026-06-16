"""
Phase rearrangement and NEMA ID mapping for the translation layer.

Rotates junction phases so coordination phases always sit at MILP positions 0
and 1 (required for NEMA ring-barrier alignment), and maps GUI
outbound/inbound indices to their standard NEMA IDs.
"""

import copy

from overlap_detection import detect_overlap_positions, detect_asymmetric_barriers


# Standard NEMA phase mapping
# Each GUI phase name maps to a NEMA phase pair (both phases run concurrently in dual-ring)
# Pairs represent movements from the same direction
#
# For overlap phase support (5-6 phases):
# - A2 is overlap phase at Barrier 1 (5-phase inputs)
# - A5 is overlap phase at Barrier 2 (6-phase inputs)
# - When phases are overlaps, their NEMA IDs are reused by later phases
PHASE_MAPPING = {
    "A1": {"nema_ids": [1, 6]},
    "A2": {"nema_ids": [2, 5]},  # Overlap phase in 5-6 phase inputs
    "A3": {"nema_ids": [3, 8]},
    "A4": {"nema_ids": [4, 7]},
    "A5": {"nema_ids": [2, 5]},  # Reuses A2's NEMA IDs (A2 is overlap in 5-phase)
    "A6": {"nema_ids": [4, 7]}   # Reuses A4's NEMA IDs (A5 is overlap in 6-phase)
}

# NEMA phase ID to (ring, position) mapping
# Ring 0: [1, 2, 3, 4] at positions [0, 1, 2, 3]
# Ring 1: [6, 5, 8, 7] at positions [0, 1, 2, 3]
NEMA_POSITION_MAP = {
    1: (0, 0), 2: (0, 1), 3: (0, 2), 4: (0, 3),
    6: (1, 0), 5: (1, 1), 8: (1, 2), 7: (1, 3)
}

# Standard NEMA ring-barrier structure
STANDARD_PHASE_IDS = [[1, 2, 3, 4], [6, 5, 8, 7]]


def get_nema_position(nema_id):
    """
    Returns (ring, position) for a NEMA phase ID

    Args:
        nema_id: NEMA phase number (1-8)

    Returns:
        tuple: (ring_index, position_index)
    """
    return NEMA_POSITION_MAP.get(nema_id, (0, 0))


def rearrange_phases_for_coordination(junction):
    """
    Rearrange phases so coordination phases (outbound/inbound) are at positions 0,1

    This ensures that the selected coordination phases are always at the beginning
    of the MILP structure (positions 0 and 1), which is required for proper NEMA
    ring-barrier alignment.

    For inputs with overlap phases (5-6 phases), this function accounts for overlaps
    when determining if coordination phases are consecutive. Overlaps are detected
    dynamically and excluded from consecutiveness checks.

    Args:
        junction: Junction dictionary with phaseNames, phases_s, outboundIdx, inboundIdx

    Returns:
        tuple: (needs_rearrangement, rearranged_junction, reverse_mapping)
            - needs_rearrangement: Boolean indicating if rearrangement was performed
            - rearranged_junction: Junction dict with rearranged phase arrays
            - reverse_mapping: List mapping new_index -> original_index for reversal

    Examples:
        Input: ["A1","A2","A3","A4"], outbound=1, inbound=2
        Output: ["A2","A3","A4","A1"] (rotate left by 1)

        Input: ["A1","A2","A3","A4","A5"], outbound=3, inbound=0, overlap=4
        Output: ["A4","A5","A1","A2","A3"] (rotate to put A4, A1 at start)
    """
    phase_names = junction.get('phaseNames', [])
    phases_s = junction.get('phases_s', [])
    phase_reds = junction.get('phaseRed_s', [])
    phase_ambers = junction.get('phaseAmber_s', [])
    outbound_indices = junction.get('outboundIdx', [0])
    inbound_indices = junction.get('inboundIdx', [0])

    # Get first index from each (assuming single coordination phase per direction)
    outbound_idx = outbound_indices[0] if outbound_indices else 0
    inbound_idx = inbound_indices[0] if inbound_indices else 0

    n = len(phase_names)

    if n < 2:
        # Not enough phases to rearrange
        return False, junction, list(range(n))

    # One-way special handling: when one direction has no coordination phase,
    # rotate purely to bring the active direction to logical position 0.
    # The suppressed direction's NEMA slot (position 3) is naturally zero for
    # junctions with < 4 phases — no real phase needs to be zeroed.
    if not outbound_indices or not inbound_indices:
        active_indices = outbound_indices if inbound_indices == [] else inbound_indices
        active_idx = active_indices[0] if active_indices else 0

        ovl_pos = detect_overlap_positions(junction)
        non_ovl = [i for i in range(n) if i not in ovl_pos]

        try:
            active_logical_pos = non_ovl.index(active_idx)
        except ValueError:
            active_logical_pos = 0

        if active_logical_pos == 0:
            return False, junction, list(range(n))

        rotation_start = active_idx
        rearranged_names   = phase_names[rotation_start:] + phase_names[:rotation_start]
        rearranged_phases  = phases_s[rotation_start:] + phases_s[:rotation_start]
        rearranged_reds    = phase_reds[rotation_start:] + phase_reds[:rotation_start] if phase_reds else []
        rearranged_ambers  = phase_ambers[rotation_start:] + phase_ambers[:rotation_start] if phase_ambers else []
        reverse_mapping    = list(range(rotation_start, n)) + list(range(rotation_start))

        new_outbound_indices = [(idx - rotation_start) % n for idx in outbound_indices]
        new_inbound_indices  = [(idx - rotation_start) % n for idx in inbound_indices]

        rearranged_junction = copy.deepcopy(junction)
        rearranged_junction['phaseNames']    = rearranged_names
        rearranged_junction['phases_s']      = rearranged_phases
        if phase_reds:
            rearranged_junction['phaseRed_s']  = rearranged_reds
        if phase_ambers:
            rearranged_junction['phaseAmber_s'] = rearranged_ambers
        rearranged_junction['outboundIdx'] = new_outbound_indices
        rearranged_junction['inboundIdx']  = new_inbound_indices

        return True, rearranged_junction, reverse_mapping

    # OVL phases are excluded from consecutiveness checks.
    overlap_positions = detect_overlap_positions(junction)
    non_overlap_indices = [i for i in range(n) if i not in overlap_positions]

    # Asymmetric bridge phases are also excluded from the MERGED direction's coordination:
    # the merge-at phase (not the bridge) is the true coordination phase for that direction.
    asym_barriers = detect_asymmetric_barriers(junction, overlap_positions)
    out_bridges = set(a['bridge'] for a in asym_barriers if a['dir'] == 'out')
    in_bridges  = set(a['bridge'] for a in asym_barriers if a['dir'] == 'in')

    # Filter outbound/inbound: exclude OVL and direction-specific bridge phases
    outbound_non_overlap = [idx for idx in outbound_indices if idx not in overlap_positions and idx not in out_bridges]
    inbound_non_overlap  = [idx for idx in inbound_indices  if idx not in overlap_positions and idx not in in_bridges]

    # Use first remaining index from each
    outbound_idx_filtered = outbound_non_overlap[0] if outbound_non_overlap else outbound_idx
    inbound_idx_filtered  = inbound_non_overlap[0]  if inbound_non_overlap  else inbound_idx

    # Find positions of these indices in the non-overlap list
    # This maps GUI indices to "logical" positions after removing overlaps
    try:
        outbound_logical_pos = non_overlap_indices.index(outbound_idx_filtered)
    except ValueError:
        outbound_logical_pos = 0

    try:
        inbound_logical_pos = non_overlap_indices.index(inbound_idx_filtered)
    except ValueError:
        inbound_logical_pos = 0

    n_logical = len(non_overlap_indices)  # Number of non-overlap phases

    # Early exit optimization: Check if coordination phases are ALREADY at logical positions 0,1

    if n_logical == 3:
        # For 3 non-overlap phases: if last phase (position 2) is NOT coordination,
        # then coordination must be at positions 0,1
        if outbound_logical_pos != 2 and inbound_logical_pos != 2:
            # Already at the start, no rearrangement needed
            return False, junction, list(range(n))

    elif n_logical >= 4:
        # For 4+ non-overlap phases: if last TWO phases are NOT coordination,
        # then coordination must be at positions 0,1
        if (outbound_logical_pos not in [n_logical-1, n_logical-2] and
            inbound_logical_pos not in [n_logical-1, n_logical-2]):
            # Already at the start, no rearrangement needed
            return False, junction, list(range(n))

    # Determine rotation start point based on LOGICAL (non-overlap) positions
    # Rule: Rotate by the LOWER index for normal consecutive,
    #       or by the HIGHER index for circular consecutive

    # Check if they're circular consecutive in the non-overlap array
    is_circular_consecutive = (
        (outbound_logical_pos == 0 and inbound_logical_pos == n_logical-1) or
        (outbound_logical_pos == n_logical-1 and inbound_logical_pos == 0)
    )

    # Check if they're normally consecutive (adjacent) in the non-overlap array
    is_normal_consecutive = abs(outbound_logical_pos - inbound_logical_pos) == 1

    if not (is_circular_consecutive or is_normal_consecutive):
        # Not consecutive - rotate based on minimum logical position
        # Map back to actual GUI index
        rotation_logical_pos = min(outbound_logical_pos, inbound_logical_pos)
        rotation_start = non_overlap_indices[rotation_logical_pos]
    elif is_circular_consecutive:
        # Circular consecutive: rotate by the HIGHER logical position
        rotation_logical_pos = max(outbound_logical_pos, inbound_logical_pos)
        rotation_start = non_overlap_indices[rotation_logical_pos]
    else:
        # Normal consecutive: rotate by the LOWER logical position
        rotation_logical_pos = min(outbound_logical_pos, inbound_logical_pos)
        rotation_start = non_overlap_indices[rotation_logical_pos]

    # Perform rotation on FULL array (including overlaps)
    rearranged_names = phase_names[rotation_start:] + phase_names[:rotation_start]
    rearranged_phases = phases_s[rotation_start:] + phases_s[:rotation_start]
    rearranged_reds = phase_reds[rotation_start:] + phase_reds[:rotation_start] if phase_reds else []
    rearranged_ambers = phase_ambers[rotation_start:] + phase_ambers[:rotation_start] if phase_ambers else []

    # Create reverse mapping: new_index -> original_index
    reverse_mapping = list(range(rotation_start, n)) + list(range(rotation_start))

    # Update indices for coordination phases after rotation
    new_outbound_idx = (outbound_idx - rotation_start) % n
    new_inbound_idx = (inbound_idx - rotation_start) % n

    # Update all indices in the arrays (including overlap positions)
    new_outbound_indices = [(idx - rotation_start) % n for idx in outbound_indices]
    new_inbound_indices = [(idx - rotation_start) % n for idx in inbound_indices]

    # Create new junction dict with rearranged data
    rearranged_junction = copy.deepcopy(junction)
    rearranged_junction['phaseNames'] = rearranged_names
    rearranged_junction['phases_s'] = rearranged_phases
    if phase_reds:
        rearranged_junction['phaseRed_s'] = rearranged_reds
    if phase_ambers:
        rearranged_junction['phaseAmber_s'] = rearranged_ambers
    rearranged_junction['outboundIdx'] = new_outbound_indices
    rearranged_junction['inboundIdx'] = new_inbound_indices

    # Note: asymmetric barrier info is now encoded in outboundIdx/inboundIdx directly,
    # which are already remapped above — no separate asymmetric field to update.

    return True, rearranged_junction, reverse_mapping


def map_inbound_outbound(junctions):
    """
    Map inbound/outbound GUI indices to standard NEMA IDs

    Since we always use standard NEMA structure [[1,2,3,4], [6,5,8,7]], this function
    determines which MILP position corresponds to the coordination phase, then returns
    the appropriate NEMA ID from the standard structure.

    Overlap phases are detected dynamically and skipped when mapping GUI indices to MILP positions.

    Args:
        junctions: List of junction dictionaries

    Returns:
        tuple: (outbound_list, inbound_list) with NEMA phase IDs
    """
    outbound = []
    inbound = []

    # Standard NEMA IDs: Position 0→[1,6], Position 1→[2,5], Position 2→[3,8], Position 3→[4,7]
    standard_ids = [[1, 2, 3, 4], [6, 5, 8, 7]]

    for junction in junctions:
        phase_names = junction.get('phaseNames', [])

        overlap_positions = detect_overlap_positions(junction)

        non_overlap_indices = [i for i in range(len(phase_names)) if i not in overlap_positions]

        outbound_indices = junction.get('outboundIdx', [0])
        inbound_indices = junction.get('inboundIdx', [0])

        # Asymmetric bridge phases must be excluded from the MERGED direction's coordination
        # list — the merge-at phase (not the bridge) is the true coordination phase.
        asym_barriers = detect_asymmetric_barriers(junction, overlap_positions)
        out_bridges = set(a['bridge'] for a in asym_barriers if a['dir'] == 'out')
        in_bridges  = set(a['bridge'] for a in asym_barriers if a['dir'] == 'in')

        outbound_non_overlap = [idx for idx in outbound_indices if idx not in overlap_positions and idx not in out_bridges]
        inbound_non_overlap  = [idx for idx in inbound_indices  if idx not in overlap_positions and idx not in in_bridges]

        n_non_overlap = len(non_overlap_indices)

        # Map GUI index to MILP position (skipping overlaps).
        # When a direction has no coordination phase (one-way corridor), point to
        # MILP position 3 (NEMA 4 for inbound / NEMA 7 for outbound).  For junctions
        # with < 4 real phases that slot is never written and stays 0 in the MILP
        # phase array, which triggers suppress_inbound / suppress_outbound.
        if outbound_non_overlap:
            outbound_idx = outbound_non_overlap[0]
            try:
                milp_outbound_pos = non_overlap_indices.index(outbound_idx)
            except ValueError:
                milp_outbound_pos = 0
        else:
            milp_outbound_pos = min(n_non_overlap, 3)

        if inbound_non_overlap:
            inbound_idx = inbound_non_overlap[0]
            try:
                milp_inbound_pos = non_overlap_indices.index(inbound_idx)
            except ValueError:
                milp_inbound_pos = 0
        else:
            milp_inbound_pos = min(n_non_overlap, 3)

        # CRITICAL FIX: SWAP ring assignment
        # Due to coordinate system reversal (API/MILP bottom-to-top vs GUI top-to-bottom):
        # GUI outbound -> MILP uses Ring 1 (IDs 6,5,8,7)
        # GUI inbound -> MILP uses Ring 0 (IDs 1,2,3,4)
        outbound.append(standard_ids[1][milp_outbound_pos])  # Ring 1 for outbound (SWAPPED)
        inbound.append(standard_ids[0][milp_inbound_pos])    # Ring 0 for inbound (SWAPPED)

    return outbound, inbound
