"""
API Translator - Converts between GUI JSON format and MILP JSON format

This module provides translation functions to convert:
- GUI-friendly JSON format → MILP's complex NEMA 8-phase ring-barrier format
- MILP optimization output → GUI-friendly JSON format
"""

import copy
from collections import OrderedDict

from overlap_detection import detect_overlap_positions, detect_asymmetric_barriers
from phase_rearrangement import (
    rearrange_phases_for_coordination, map_inbound_outbound,
    get_nema_position, PHASE_MAPPING, NEMA_POSITION_MAP, STANDARD_PHASE_IDS
)
from nema_builder import (
    build_nema_structure, parse_phases_with_overlaps,
    reconstruct_phases_with_overlaps, get_milp_phase_name
)
from milp_input_builders import (
    calculate_distances, format_queue_times,
    build_speed_range, build_speed_change_range
)


from cycle_standardization import standardize_cycle_lengths  # re-exported for frontendAPI.py


def gui_to_milp(gui_json, standardize=True):
    """
    Main translation function: GUI format → MILP format

    Args:
        gui_json: Dictionary with GUI JSON structure
        standardize: If True (default), average cycle lengths across junctions
                     before translation. Pass False to skip for testing.

    Returns:
        dict: MILP-compatible input dictionary
    """
    junctions = gui_json.get('junctions', [])
    num_junctions = len(junctions)

    if num_junctions < 2:
        raise ValueError("At least 2 junctions required for optimization")

    opt_config = gui_json.get('optimization', {})

    # STEP 0: Standardize all junction cycle lengths to their average
    if standardize:
        gui_json = standardize_cycle_lengths(gui_json)
    junctions = gui_json.get('junctions', [])

    # STEP 1: Rearrange phases for coordination BEFORE all other processing
    # This ensures coordination phases are at positions 0,1 for proper NEMA alignment
    rearranged_junctions = []
    rearrangement_mappings = []

    for idx, junction in enumerate(junctions):
        needs_rearrangement, rearranged_junction, reverse_mapping = rearrange_phases_for_coordination(junction)
        rearranged_junctions.append(rearranged_junction)
        rearrangement_mappings.append(reverse_mapping)

        # VALIDATION: Check that only the coordination pair is selected (positions 0, 1)
        # The next 2 phases (positions 2, 3) should NOT be in outboundIdx/inboundIdx
        overlap_positions = detect_overlap_positions(rearranged_junction)
        phase_names = rearranged_junction.get('phaseNames', [])
        outbound_indices = rearranged_junction.get('outboundIdx', [])
        inbound_indices = rearranged_junction.get('inboundIdx', [])

        # Build non-overlap indices
        non_overlap_indices = [i for i in range(len(phase_names)) if i not in overlap_positions]

        if len(non_overlap_indices) >= 4:
            # Get the phases at logical positions 2 and 3 (the next 2 after coordination pair)
            forbidden_pos_2 = non_overlap_indices[2]  # Logical position 2
            forbidden_pos_3 = non_overlap_indices[3]  # Logical position 3

            # Determine the actual COORDINATION phase for each direction.
            # For asymmetric (T-junction) junctions, bridge phases are excluded from
            # outbound coordination and merge_at exclusive phases may appear in inbound
            # as non-coordination members — only the first filtered phase is the true
            # coordination phase that must sit at logical positions 0 or 1.
            asym_for_val = detect_asymmetric_barriers(rearranged_junction, overlap_positions)
            out_bridges_val = set(a['bridge'] for a in asym_for_val if a['dir'] == 'out')
            in_bridges_val  = set(a['bridge'] for a in asym_for_val if a['dir'] == 'in')

            outbound_non_overlap = [i for i in outbound_indices if i not in overlap_positions]
            inbound_non_overlap  = [i for i in inbound_indices  if i not in overlap_positions]

            # Coordination phase = first non-overlap, non-bridge phase for each direction
            coord_out_list = [i for i in outbound_non_overlap if i not in out_bridges_val]
            coord_in_list  = [i for i in inbound_non_overlap  if i not in in_bridges_val]
            coord_out = coord_out_list[0] if coord_out_list else None
            coord_in  = coord_in_list[0]  if coord_in_list  else None

            # Only the actual coordination phases must be in the first two positions
            for forbidden in (forbidden_pos_2, forbidden_pos_3):
                if (coord_out is not None and coord_out == forbidden) or \
                   (coord_in  is not None and coord_in  == forbidden):
                    raise ValueError(
                        f"Invalid inbound/outbound configuration for junction {idx + 1} ({junction.get('name', 'Unknown')}): "
                        f"Phase at position {forbidden} ({phase_names[forbidden]}) cannot be selected as a coordination phase. "
                        f"Only the first two non-overlap phases should be designated as outbound/inbound."
                    )

    # Use rearranged junctions for all subsequent processing
    junctions = rearranged_junctions

    # Build NEMA 8-phase structure
    phase, phaseID, phaseRed, phaseAmber = build_nema_structure(junctions, opt_config)

    # Calculate distances from positions
    distance = calculate_distances(junctions)

    # Extract inbound/outbound NEMA IDs
    outbound, inbound = map_inbound_outbound(junctions)

    # Format queue times
    queue_time = format_queue_times(gui_json)

    # Build speed parameters
    num_segments = num_junctions - 1
    speedRange = build_speed_range(gui_json, num_segments)
    speedChangeRange = build_speed_change_range(gui_json, num_segments)

    # Return MILP-compatible dictionary in the exact order from Correct Input Shape.txt
    return OrderedDict([
        ('phase', phase),
        ('phaseID', phaseID),
        ('phaseRed', phaseRed),
        ('phaseAmber', phaseAmber),
        ('outbound', outbound),
        ('inbound', inbound),
        ('queue_time', queue_time),
        ('k', opt_config.get('k', 1)),
        ('speedRange', speedRange),
        ('speedChangeRange', speedChangeRange),
        ('distance', distance),
        ('cycleRange', opt_config.get('cycleRange', [100, 200])),
        ('flag', opt_config.get('flag', 1))
    ])



def milp_to_gui(milp_output, original_gui_json, milp_input):
    """
    Convert MILP optimization output back to GUI format
    Returns the complete GUI input structure with optimized values filled in

    Args:
        milp_output: Dictionary with MILP optimization results
        original_gui_json: Original GUI input (to preserve structure)
        milp_input: Original MILP input (to get outbound/inbound NEMA IDs)

    Returns:
        dict: Complete GUI JSON structure with optimized values
    """
    # Deep copy the original GUI input to preserve structure
    gui_output = copy.deepcopy(original_gui_json)

    # Update optimization config with optimized cycle length and bandwidth if available
    if 'optimization' not in gui_output:
        gui_output['optimization'] = {}

    if 'NewCycle' in milp_output:
        gui_output['optimization']['optimized_cycle_s'] = int(milp_output['NewCycle'])

    # Include bandwidth values from MILP output
    if 'Outbound_bandwidth_actual' in milp_output:
        gui_output['optimization']['outbound_bandwidth_s'] = int(milp_output['Outbound_bandwidth_actual'])
    if 'Inbound_bandwidth_actual' in milp_output:
        gui_output['optimization']['inbound_bandwidth_s'] = int(milp_output['Inbound_bandwidth_actual'])

    # Update travel times with optimized values
    num_junctions = len(gui_output.get('junctions', []))
    num_segments = num_junctions - 1

    if num_segments > 0:
        travelOut_optimized = []
        travelIn_optimized = []

        # Extract optimized travel times from MILP output
        for i in range(num_segments):
            segment_num = f"{i+1}-{i+2}"

            # Get outbound travel time
            outbound_key = f"Time_Outbound{segment_num}"
            if outbound_key in milp_output:
                travelOut_optimized.append(int(milp_output[outbound_key]))

            # Get inbound travel time
            inbound_key = f"Time_Inbound{segment_num}"
            if inbound_key in milp_output:
                travelIn_optimized.append(int(milp_output[inbound_key]))

        # Update GUI output with optimized travel times (NO SWAP)
        if travelOut_optimized:
            gui_output['travelOut_s'] = travelOut_optimized
        if travelIn_optimized:
            gui_output['travelIn_s'] = travelIn_optimized

    # Get optimized phase data from MILP output
    optimized_phases = milp_output.get('Phase', [])
    optimized_phase_ids = milp_output.get('Phase_ID', [])

    # Update each junction with optimized values
    for i, junction in enumerate(gui_output.get('junctions', [])):
        # Update offset with optimized value
        junction['offset_s'] = int(milp_output.get(f'offset_{i}', 0))

    # Continue with phase updates for each junction
    for i, junction in enumerate(gui_output.get('junctions', [])):
        # Update phase durations and names following optimized Phase_ID order
        if i < len(optimized_phases) and i < len(optimized_phase_ids):
            original_phase_names = junction.get('phaseNames', [])
            original_phase_count = len(original_phase_names)

            # Get the original junction from input
            original_junction = original_gui_json['junctions'][i]

            # CRITICAL FIX: Re-apply rearrangement to get what was actually sent to MILP
            needs_rearrangement, rearranged_junction, reverse_mapping = rearrange_phases_for_coordination(original_junction)

            if needs_rearrangement:
                # Use the rearranged junction (what MILP received)
                milp_junction = rearranged_junction
                milp_phase_names = rearranged_junction['phaseNames']
            else:
                # No rearrangement, use original
                milp_junction = original_junction
                milp_phase_names = original_junction['phaseNames']

            # CRITICAL: Detect overlaps on the REARRANGED junction, not the original!
            # After rearrangement, overlap positions have changed
            overlap_positions = detect_overlap_positions(milp_junction)
            original_phase_count = len(milp_phase_names)
            non_overlap_indices = [idx for idx in range(original_phase_count) if idx not in overlap_positions]

            # Now build NEMA mapping using the phase names that MILP actually saw
            nema_to_original_name = {}
            position_to_name = {}
            standard_ids = [[1, 2, 3, 4], [6, 5, 8, 7]]

            # For non-overlap phases, map MILP positions to phase names
            for milp_pos, gui_idx in enumerate(non_overlap_indices):
                # Use milp_phase_names (after rearrangement) instead of original_phase_names
                if gui_idx < len(milp_phase_names) and milp_pos < 4:
                    phase_name = milp_phase_names[gui_idx]
                    # Map both NEMA IDs (from both rings) to this phase name
                    nema_to_original_name[standard_ids[0][milp_pos]] = phase_name
                    nema_to_original_name[standard_ids[1][milp_pos]] = phase_name
                    # Also map MILP position to phase name (for inbound/outbound index updates)
                    position_to_name[milp_pos] = phase_name

            phase_id_array = optimized_phase_ids[i]
            optimized_phase_array = optimized_phases[i]

            # Build reordered phase names by reading optimized Phase_ID array
            # MILP may have reordered phases for better bandwidth
            reordered_milp_phase_names = []

            # Track which NEMA IDs have ring0=0 due to asymmetric barrier handling,
            # so those bridge phases are still included in the output even with duration=0.
            # Use NEMA-ID lookup (not position) because MILP reorders phases in its
            # output for leading/lagging patterns — bridge IDs can land at any position.
            asym_barriers_milp = detect_asymmetric_barriers(milp_junction, overlap_positions)
            asym_zero_ring0_nema_ids = set()
            for asym in asym_barriers_milp:
                gui_idx = asym['merge_at'] if asym['dir'] == 'out' else asym['bridge']
                if gui_idx in non_overlap_indices:
                    milp_pos = non_overlap_indices.index(gui_idx)
                    if milp_pos < 4:
                        asym_zero_ring0_nema_ids.add(standard_ids[0][milp_pos])

            for pos_idx in range(len(phase_id_array[0])):
                nema_id = phase_id_array[0][pos_idx]  # Get NEMA ID at this position
                duration = int(optimized_phase_array[0][pos_idx])

                # Include phases with non-zero ring0 duration, OR bridge phases whose
                # ring0=0 is by design (they still carry green time in ring1).
                is_excl_out_zero = nema_id in asym_zero_ring0_nema_ids
                if (duration > 0 or is_excl_out_zero) and nema_id in nema_to_original_name:
                    phase_name = nema_to_original_name[nema_id]
                    reordered_milp_phase_names.append(phase_name)

            # Reconstruct GUI phase durations including overlaps
            # CRITICAL FIX: Use milp_junction (rearranged), not original_junction
            # The overlap positions changed after GUI→MILP rearrangement
            ring0_durations = [int(d) for d in optimized_phase_array[0]]
            ring1_durations = [int(d) for d in optimized_phase_array[1]]

            gui_phase_durations = reconstruct_phases_with_overlaps(
                ring0_durations,
                ring1_durations,
                milp_junction
            )

            # Reconstruct phase names: insert overlaps between their adjacent phases
            # based on the MILP junction's structure (after GUI→MILP rearrangement)

            # Build mapping: overlap position -> (left phase name, right phase name)
            # Use milp_phase_names (rearranged) for correct phase name references
            overlap_adjacent_phases = {}
            for overlap_pos in overlap_positions:
                # Find the non-overlap phases immediately before and after this overlap
                left_phase = None
                right_phase = None

                # Search backwards for left phase
                for pos in range(overlap_pos - 1, -1, -1):
                    if pos not in overlap_positions and pos < len(milp_phase_names):
                        left_phase = milp_phase_names[pos]
                        break

                # Search forwards for right phase
                for pos in range(overlap_pos + 1, len(milp_phase_names)):
                    if pos not in overlap_positions:
                        right_phase = milp_phase_names[pos]
                        break

                overlap_adjacent_phases[overlap_pos] = (left_phase, right_phase, milp_phase_names[overlap_pos])

            # Start with reordered non-overlap phase names
            final_phase_names = reordered_milp_phase_names.copy()

            # Insert each overlap between its left and right phases in the reordered list
            for overlap_pos in sorted(overlap_positions):
                if overlap_pos in overlap_adjacent_phases:
                    left_phase, right_phase, overlap_name = overlap_adjacent_phases[overlap_pos]

                    # Find where left and right phases are in the reordered list
                    left_idx = None
                    right_idx = None

                    for idx, phase_name in enumerate(final_phase_names):
                        if phase_name == left_phase:
                            left_idx = idx
                        if phase_name == right_phase:
                            right_idx = idx

                    # Insert overlap between them
                    if left_idx is not None and right_idx is not None:
                        # Determine insertion position (between left and right)
                        if abs(right_idx - left_idx) == 1:
                            # Adjacent phases - insert between them
                            insert_pos = max(left_idx, right_idx)
                            final_phase_names.insert(insert_pos, overlap_name)
                        elif right_idx > left_idx:
                            # Right is after left - insert after left
                            final_phase_names.insert(left_idx + 1, overlap_name)
                        else:
                            # Left is after right - insert after right
                            final_phase_names.insert(right_idx + 1, overlap_name)
                    elif left_idx is not None:
                        # Only found left phase - insert after it
                        final_phase_names.insert(left_idx + 1, overlap_name)
                    elif right_idx is not None:
                        # Only found right phase - insert before it
                        final_phase_names.insert(right_idx, overlap_name)
                    else:
                        # Couldn't find adjacent phases - append at end
                        final_phase_names.append(overlap_name)

            # Update phaseNames and phases_s with reordered values including overlaps
            if final_phase_names and gui_phase_durations:
                junction['phaseNames'] = final_phase_names
                junction['phases_s'] = gui_phase_durations

                # ======================================================================
                # PRESERVE ORIGINAL OUTBOUND/INBOUND PHASE NAMES
                # Track which phase names the user originally designated as outbound/inbound
                # and find their positions in the final reordered array
                # ======================================================================

                # Get outbound/inbound phase names from the MILP junction (after GUI→MILP rearrangement)
                # This ensures we're using the correct phase names that were actually sent to MILP
                milp_outbound_indices = milp_junction.get('outboundIdx', [])
                milp_inbound_indices = milp_junction.get('inboundIdx', [])
                milp_overlap_positions = overlap_positions  # Already calculated for milp_junction

                # Extract NON-OVERLAP phase names only
                # (overlaps should not be used for final rearrangement rotation point)
                milp_outbound_names = []
                milp_inbound_names = []

                for idx in milp_outbound_indices:
                    if idx not in milp_overlap_positions and idx < len(milp_phase_names):
                        milp_outbound_names.append(milp_phase_names[idx])

                for idx in milp_inbound_indices:
                    if idx not in milp_overlap_positions and idx < len(milp_phase_names):
                        milp_inbound_names.append(milp_phase_names[idx])

                # Now find where these NON-OVERLAP phase names ended up in final_phase_names
                # (after MILP reordering and overlap insertion)
                outbound_indices = []
                inbound_indices = []

                for phase_name in milp_outbound_names:
                    if phase_name in final_phase_names:
                        outbound_idx = final_phase_names.index(phase_name)
                        outbound_indices.append(outbound_idx)

                for phase_name in milp_inbound_names:
                    if phase_name in final_phase_names:
                        inbound_idx = final_phase_names.index(phase_name)
                        inbound_indices.append(inbound_idx)

                # CRITICAL: Include overlap phases that are between outbound and inbound
                # These overlaps should be included in the indices for proper array updates
                if outbound_indices and inbound_indices:
                    outbound_idx = outbound_indices[0]
                    inbound_idx = inbound_indices[0]

                    # Find overlap phases between the coordination phases
                    min_idx = min(outbound_idx, inbound_idx)
                    max_idx = max(outbound_idx, inbound_idx)

                    overlap_names = [milp_phase_names[pos] for pos in milp_overlap_positions]

                    for idx in range(min_idx, max_idx + 1):
                        if idx < len(final_phase_names):
                            phase_name = final_phase_names[idx]
                            # Check if this is an overlap phase
                            if phase_name in overlap_names:
                                # Add overlap to both arrays if not already present
                                if idx not in outbound_indices:
                                    outbound_indices.append(idx)
                                if idx not in inbound_indices:
                                    inbound_indices.append(idx)

                # TODO(pending-decision): Rotate output so the outbound phase is always at
                # position 0 in the GUI array. Currently disabled because MILP outputs
                # offset_s relative to the true cycle start (Ring 0, Position 0), and
                # rotating here would corrupt those offsets. Enabling requires removing
                # the post-processing in milp2FINAL.py (around the offset recalculation
                # block) so offsets are instead referenced to the outbound phase.
                if outbound_indices and final_phase_names and gui_phase_durations:
                    # Update the junction's phase arrays with final values
                    junction['phaseNames'] = final_phase_names
                    junction['phases_s'] = gui_phase_durations

                # Update junction indices (already swapped above, and now rotated)
                if outbound_indices:
                    outbound_indices.sort()
                    junction['outboundIdx'] = outbound_indices
                if inbound_indices:
                    inbound_indices.sort()
                    junction['inboundIdx'] = inbound_indices

    # CRITICAL: Adjust offsets based on master junction selection
    # This MUST happen AFTER all junction processing (including final rearrangement offset adjustments)
    # to ensure the master junction offset is always 0
    master_junction_id = original_gui_json.get('optimization', {}).get('masterJunctionId')

    if master_junction_id is not None:
        # Find the master junction by ID
        master_idx = None
        junctions_list = gui_output.get('junctions', [])

        for i, junction in enumerate(junctions_list):
            if junction.get('id') == master_junction_id:
                master_idx = i
                break

        # If master junction found, adjust all offsets relative to it
        if master_idx is not None:
            master_offset = junctions_list[master_idx]['offset_s']

            # Subtract master offset from all junction offsets
            # This GUARANTEES the master junction has offset = 0, others can be negative/positive
            for junction in junctions_list:
                junction['offset_s'] = junction['offset_s'] - master_offset

    return gui_output
