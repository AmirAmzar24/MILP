"""
NEMA ring-barrier structure builder and reconstructor for the translation layer.

Converts GUI flexible phase arrays (4-6 phases) into the dual-ring MILP format
and reconstructs GUI phases from MILP's dual-ring output.
"""

from overlap_detection import detect_overlap_positions, detect_asymmetric_barriers


def parse_phases_with_overlaps(phases_s, overlap_positions, junction=None):
    """
    Parse phases and create ring durations, handling OVL and asymmetric barriers.
    Converts GUI input into dual-ring MILP format.

    Args:
        phases_s: Phase durations from GUI (4-6 values)
        overlap_positions: List of GUI indices that are OVL (e.g., [1] or [1, 4])
        junction: Full junction dict (used for asymmetric barrier detection)

    Returns:
        tuple: (ring0_durations, ring1_durations, non_overlap_indices)
            - ring0_durations: MILP position durations for Ring 0
            - ring1_durations: MILP position durations for Ring 1
            - non_overlap_indices: GUI indices of non-OVL phases

    Logic for OVL:
        - OVL phases are excluded from both rings' base arrays
        - Ring 0 gets OVL duration added to the position AFTER the overlap
        - Ring 1 gets OVL duration added to the position BEFORE the overlap

    Logic for Asymmetric Barrier (derived from inboundIdx/outboundIdx pattern):
        - Within a barrier, if one phase is exclusive to one direction and the
          adjacent phase appears in BOTH directions (the bridge), the exclusive
          phase absorbs the full barrier total in its ring; the bridge gets 0.
        - e.g. phases_s=[20,40,40,0], outboundIdx=[0,1], inboundIdx=[1]:
            ring0=[20,40,40,0]  (inbound keeps both sub-phases)
            ring1=[60, 0,40,0]  (outbound: A1 absorbs barrier-1 total of 60s)
    """
    junction = junction or {}

    if not overlap_positions:
        # No OVL — both rings start identical
        ring0 = list(phases_s)
        ring1 = list(phases_s)
        non_overlap_indices = list(range(len(phases_s)))
    else:
        # Build list of non-OVL phase indices
        non_overlap_indices = [i for i in range(len(phases_s)) if i not in overlap_positions]
        base_durations = [phases_s[i] for i in non_overlap_indices]
        ring0 = base_durations.copy()
        ring1 = base_durations.copy()

        # Apply OVL: add to adjacent positions in alternating rings
        for overlap_idx in overlap_positions:
            overlap_value = phases_s[overlap_idx]
            non_overlap_before = sum(1 for i in non_overlap_indices if i < overlap_idx)
            if non_overlap_before == 0:
                pass
            elif non_overlap_before <= len(ring0):
                if non_overlap_before < len(ring0):
                    ring0[non_overlap_before] += overlap_value
                if non_overlap_before > 0:
                    ring1[non_overlap_before - 1] += overlap_value

    # Apply asymmetric barriers detected from within-barrier bridge pattern
    # New format: bridge phase absorbs full barrier total in the OPPOSITE ring;
    # exclusive phase gets 0 in that ring; the ring belonging to the exclusive
    # direction keeps its original split values unchanged.
    asym_barriers = detect_asymmetric_barriers(junction, overlap_positions)
    for asym in asym_barriers:
        merge_at = asym['merge_at']
        bridge   = asym['bridge']
        direction = asym['dir']
        if merge_at in non_overlap_indices and bridge in non_overlap_indices:
            pos_merge  = non_overlap_indices.index(merge_at)
            pos_bridge = non_overlap_indices.index(bridge)
            barrier_total = ring0[pos_merge] + ring0[pos_bridge]
            if direction == 'out':
                # Exclusive outbound stays in ring1 (unchanged).
                # ring0 (inbound ring): bridge absorbs full barrier total, exclusive gets 0.
                ring0[pos_bridge] = barrier_total
                ring0[pos_merge]  = 0
            else:
                # Exclusive inbound stays in ring1 (unchanged).
                # ring0 (inbound ring): merge_at absorbs full barrier total, bridge gets 0.
                ring0[pos_merge]  = barrier_total
                ring0[pos_bridge] = 0

    # Barrier zeroing: for T-junction type junctions (those with detected asym barriers),
    # zero ring1 for any barrier where the outbound direction has no phases.
    # ring0 is never zeroed here — it always retains phases_s values for all barriers.
    if asym_barriers:
        outbound_set = set(junction.get('outboundIdx', []))
        # Always iterate all 4 NEMA positions so that short (3-phase) ring arrays
        # still have their barrier-1 position (index 2) zeroed correctly.
        for b in range(2):
            p0, p1 = b * 2, b * 2 + 1
            orig_p0 = non_overlap_indices[p0] if p0 < len(non_overlap_indices) else None
            orig_p1 = non_overlap_indices[p1] if p1 < len(non_overlap_indices) else None
            outbound_in_barrier = (
                (orig_p0 is not None and orig_p0 in outbound_set) or
                (orig_p1 is not None and orig_p1 in outbound_set)
            )
            if not outbound_in_barrier:
                if p0 < len(ring1):
                    ring1[p0] = 0
                if p1 < len(ring1):
                    ring1[p1] = 0

    return ring0, ring1, non_overlap_indices


def get_milp_phase_name(phase_names, milp_position):
    """
    Get the phase name for a given MILP position, accounting for overlap phases.

    When GUI sends 5 or 6 phases, positions 1 and/or 4 are overlaps that don't
    map to MILP positions. This function maps MILP positions to the correct
    non-overlap phase names.

    Args:
        phase_names: Array of phase names (4, 5, or 6 elements)
        milp_position: MILP position index (0-3)

    Returns:
        str: Phase name corresponding to the MILP position

    Examples:
        For 5 phases ["A1", "A2", "A3", "A4", "A5"]:
            MILP pos 0 → "A1" (index 0)
            MILP pos 1 → "A3" (index 2, skip overlap at index 1)
            MILP pos 2 → "A4" (index 3)
            MILP pos 3 → "A5" (index 4)

        For 6 phases ["A1", "A2", "A3", "A4", "A5", "A6"]:
            MILP pos 0 → "A1" (index 0)
            MILP pos 1 → "A3" (index 2, skip overlap at index 1)
            MILP pos 2 → "A4" (index 3)
            MILP pos 3 → "A6" (index 5, skip overlap at index 4)
    """
    phase_count = len(phase_names)

    if phase_count == 4:
        # Direct mapping for 4 phases
        return phase_names[milp_position]

    elif phase_count == 5:
        # Skip index 1 (overlap at Barrier 1)
        index_map = [0, 2, 3, 4]
        return phase_names[index_map[milp_position]]

    elif phase_count == 6:
        # Skip indices 1 and 4 (overlaps at both barriers)
        index_map = [0, 2, 3, 5]
        return phase_names[index_map[milp_position]]

    else:
        # Fallback for unexpected counts
        return phase_names[min(milp_position, len(phase_names) - 1)]


def build_nema_structure(junctions, optimization_config):
    """
    Converts GUI's simple phases to NEMA 8-phase ring-barrier structure

    Args:
        junctions: List of junction dictionaries from GUI JSON (may be pre-rearranged)
        optimization_config: Optimization settings with defaults

    Returns:
        tuple: (phase, phaseID, phaseRed, phaseAmber) in MILP format
    """
    # Initialize 3D arrays: [junctions][rings][positions]
    phase = []
    phaseID = []
    phaseRed = []
    phaseAmber = []

    for junction in junctions:
        # Start with STANDARD NEMA structure (always full 4 positions)
        # This ensures all junctions have the same structure regardless of actual phase count
        junction_phases = [[0, 0, 0, 0], [0, 0, 0, 0]]  # Ring 0, Ring 1
        junction_ids = [[1, 2, 3, 4], [6, 5, 8, 7]]      # Standard NEMA ring-barrier IDs
        junction_reds = [[0, 0, 0, 0], [0, 0, 0, 0]]
        junction_ambers = [[0, 0, 0, 0], [0, 0, 0, 0]]

        # Get default values
        default_red = optimization_config.get('defaultRed_s', 3)
        default_amber = optimization_config.get('defaultAmber_s', 3)

        phases_s = junction.get('phases_s', [])

        # Detect overlap positions dynamically based on inbound/outbound indices
        overlap_positions = detect_overlap_positions(junction)

        # Parse phases — handles OVL and asymmetric barrier configurations
        ring0_durations, ring1_durations, non_overlap_indices = parse_phases_with_overlaps(
            phases_s, overlap_positions, junction
        )

        # Get red/amber times (use defaults if not provided)
        phase_reds = junction.get('phaseRed_s', [default_red] * len(phases_s))
        phase_ambers = junction.get('phaseAmber_s', [default_amber] * len(phases_s))

        # Build NEMA structure for all 4 MILP positions
        # CRITICAL: Use standard NEMA IDs based on MILP position, NOT phase names!
        for i in range(4):
            if i >= len(ring0_durations):
                break

            # NEMA IDs are assigned based on MILP position (0→[1,6], 1→[2,5], 2→[3,8], 3→[4,7])
            # junction_ids already initialized to standard structure, no need to reassign

            # Set DIFFERENT durations for each ring (handles overlaps)
            junction_phases[0][i] = ring0_durations[i]
            junction_phases[1][i] = ring1_durations[i]

            # Look up base clearance from original phase data
            if i < len(non_overlap_indices):
                original_idx = non_overlap_indices[i]
                base_red   = phase_reds[original_idx]   if original_idx < len(phase_reds)   else default_red
                base_amber = phase_ambers[original_idx] if original_idx < len(phase_ambers) else default_amber
            else:
                base_red   = default_red
                base_amber = default_amber

            # Each ring gets zero clearance only when its own duration is 0
            # (asymmetric junctions have different zero positions per ring)
            junction_reds[0][i]   = 0 if ring0_durations[i] == 0 else base_red
            junction_ambers[0][i] = 0 if ring0_durations[i] == 0 else base_amber
            junction_reds[1][i]   = 0 if ring1_durations[i] == 0 else base_red
            junction_ambers[1][i] = 0 if ring1_durations[i] == 0 else base_amber

        phase.append(junction_phases)
        phaseID.append(junction_ids)
        phaseRed.append(junction_reds)
        phaseAmber.append(junction_ambers)

    return phase, phaseID, phaseRed, phaseAmber


def reconstruct_phases_with_overlaps(ring0_durations, ring1_durations, original_junction):
    """
    Reconstruct GUI phases including overlap values from MILP's dual-ring output
    Uses dynamic overlap detection based on inbound/outbound indices.

    Args:
        ring0_durations: List of 4 phase durations from Ring 0
        ring1_durations: List of 4 phase durations from Ring 1
        original_junction: Original junction dictionary (to detect overlap positions)

    Returns:
        list: Phase durations in GUI format (4-6 values including overlaps)
    """
    original_phase_count = len(original_junction.get('phaseNames', []))

    # Detect overlap positions dynamically
    overlap_positions = detect_overlap_positions(original_junction)

    if not overlap_positions:
        # No overlaps: base result starts from ring0.
        # For asym junctions, the split ring (ring1 for asym-out, ring0 for asym-in)
        # holds the individual phase values; the other ring holds the merged total or 0.
        result = list(ring0_durations[:original_phase_count])

        asym_barriers = detect_asymmetric_barriers(original_junction, overlap_positions)
        non_ovl_idx = list(range(original_phase_count))  # no OVL in this branch

        for asym in asym_barriers:
            merge_at = asym['merge_at']
            bridge   = asym['bridge']
            if merge_at >= len(result) or bridge >= len(result):
                continue
            # pos_merge / pos_bridge == merge_at / bridge for the no-OVL case
            pos_merge  = non_ovl_idx.index(merge_at)  if merge_at  in non_ovl_idx else merge_at
            pos_bridge = non_ovl_idx.index(bridge)    if bridge    in non_ovl_idx else bridge

            # For both asym_out and asym_in, ring1 retains the original split values.
            # ring0 was the modified ring (one position absorbed barrier total, other=0).
            # Recover both phases from ring1 regardless of direction.
            if pos_merge < len(ring1_durations):
                result[merge_at] = ring1_durations[pos_merge]
            if pos_bridge < len(ring1_durations):
                result[bridge] = ring1_durations[pos_bridge]

        return result

    # Build GUI phases by inserting overlaps at detected positions
    gui_phases = []
    milp_pos = 0

    for gui_pos in range(original_phase_count):
        if gui_pos in overlap_positions:
            # Calculate overlap from ring difference
            # Overlap affects the MILP positions before and after it
            if milp_pos > 0:
                # Overlap = difference between ring durations at adjacent positions
                overlap_value = abs(ring1_durations[milp_pos - 1] - ring0_durations[milp_pos - 1])
            elif milp_pos < len(ring0_durations):
                overlap_value = abs(ring1_durations[milp_pos] - ring0_durations[milp_pos])
            else:
                overlap_value = 0
            gui_phases.append(overlap_value)
        else:
            # Regular phase - use minimum of both rings (base value before overlap was added)
            if milp_pos < len(ring0_durations):
                base_value = min(ring0_durations[milp_pos], ring1_durations[milp_pos])
                gui_phases.append(base_value)
                milp_pos += 1
            else:
                gui_phases.append(0)

    return gui_phases
