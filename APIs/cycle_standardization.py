"""
Cycle standardization for the translation layer.

Scales all junction cycle lengths to their integer average before
the MILP runs, so the solver's proportional phase scaling disturbs
user-specified queue times as little as possible.
"""

import copy


def standardize_cycle_lengths(gui_json):
    """
    PRE-PROCESS: Standardize all junction cycle lengths to their average.

    Calculates each junction's cycle length as sum(phases_s), then scales
    every junction's green times (phases_s) and its corresponding queue times
    (queueOut_s[j], queueIn_s[j]) proportionally so all junctions share the
    same average cycle length.

    Args:
        gui_json: Dictionary with GUI JSON structure (not mutated)

    Returns:
        dict: New gui_json with standardized phases_s and queue times
    """
    gui_json = copy.deepcopy(gui_json)

    junctions = gui_json.get('junctions', [])
    if len(junctions) < 2:
        return gui_json

    # Calculate each junction's current cycle length
    cycle_lengths = [sum(j.get('phases_s', [])) for j in junctions]

    # Skip if any junction has a zero cycle (guard against division by zero)
    if any(c == 0 for c in cycle_lengths):
        return gui_json

    # Round average cycle to nearest integer as the shared target
    avg_cycle = round(sum(cycle_lengths) / len(cycle_lengths))

    queue_out = gui_json.get('queueOut_s', [])
    queue_in  = gui_json.get('queueIn_s', [])

    for idx, junction in enumerate(junctions):
        current_cycle = cycle_lengths[idx]
        scale = avg_cycle / current_cycle

        # Scale green times then apply largest-remainder rounding so that
        # all values are integers and their sum equals avg_cycle exactly.
        scaled = [p * scale for p in junction['phases_s']]
        floored = [int(v) for v in scaled]
        remainders = [(scaled[i] - floored[i], i) for i in range(len(scaled))]
        leftover = avg_cycle - sum(floored)
        # Distribute leftover seconds to phases with the largest fractional parts
        for _, i in sorted(remainders, reverse=True)[:leftover]:
            floored[i] += 1
        junction['phases_s'] = floored

        # Scale queue times (rounded to nearest integer)
        if idx < len(queue_out):
            queue_out[idx] = round(queue_out[idx] * scale)
        if idx < len(queue_in):
            queue_in[idx] = round(queue_in[idx] * scale)

    gui_json['queueOut_s'] = queue_out
    gui_json['queueIn_s']  = queue_in

    return gui_json
