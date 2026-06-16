"""
MILP input array builders for the translation layer.

Constructs the distance, queue-time, speed-range, and speed-change-range
arrays that gui_to_milp assembles into the final MILP input dict.
"""


def calculate_distances(junctions):
    """
    Calculate distances between consecutive junctions from absolute positions

    Args:
        junctions: List of junction dictionaries with 'position_m' field

    Returns:
        list: [[outbound_distances], [inbound_distances]] in meters
    """
    if len(junctions) < 2:
        return [[], []]

    distances = []
    for i in range(len(junctions) - 1):
        dist = abs(junctions[i+1]['position_m'] - junctions[i]['position_m'])
        distances.append(dist)

    # Both directions have same distances
    return [distances, distances]


def format_queue_times(gui_json):
    """
    Format queue times from GUI format to MILP format

    Args:
        gui_json: Full GUI JSON input

    Returns:
        list: [[outbound_queue_times], [inbound_queue_times]]
    """
    queue_out = gui_json.get('queueOut_s', [])
    queue_in = gui_json.get('queueIn_s', [])

    # Ensure we have queue times for all junctions
    num_junctions = len(gui_json.get('junctions', []))

    # Pad with zeros if needed
    while len(queue_out) < num_junctions:
        queue_out.append(0)
    while len(queue_in) < num_junctions:
        queue_in.append(0)

    return [queue_out, queue_in]


def build_speed_range(gui_json, num_segments):
    """
    Build speed range array from GUI config

    Args:
        gui_json: Full GUI JSON input
        num_segments: Number of segments (junctions - 1)

    Returns:
        list: [[[min, max], ...], [[min, max], ...]] for outbound/inbound
    """
    opt_config = gui_json.get('optimization', {})
    default_speed = opt_config.get('speedRange_kmh', [40, 60])

    # Create speed ranges for each segment
    # Format: [direction][segment][min, max]
    speed_range = [
        [[default_speed[0], default_speed[1]] for _ in range(num_segments)],
        [[default_speed[0], default_speed[1]] for _ in range(num_segments)]
    ]

    return speed_range


def build_speed_change_range(gui_json, num_segments):
    """
    Build speed change range array from GUI config

    Args:
        gui_json: Full GUI JSON input
        num_segments: Number of segments (junctions - 1)

    Returns:
        list: [[[min, max], ...], [[min, max], ...]] for outbound/inbound

    Note:
        MILP iterates over (junctions - 2) elements, which equals (num_segments - 1).
        We need at least max(1, num_segments - 1) elements per direction.
    """
    opt_config = gui_json.get('optimization', {})
    default_change = opt_config.get('speedChangeRange_kmh', [-20, 20])

    # MILP needs (junctions - 2) = (num_segments - 1) elements
    # Minimum of 1 element is required
    num_change_elements = max(1, num_segments - 1)

    # Create speed change ranges for each element
    speed_change = [
        [[default_change[0], default_change[1]] for _ in range(num_change_elements)],
        [[default_change[0], default_change[1]] for _ in range(num_change_elements)]
    ]

    return speed_change
