import numpy as np


def compute_actual_bandwidth(numberofjunctions, cycle, time, r, phi,
                             delta_new, cnew_1, cnew_3,
                             outRed_final, inRed_final):
    """Compute the ACTUAL (final) green-band bandwidth returned to the GUI.

    Post-processing step over the optimised timing plan: pure time-space-diagram
    geometry with no solver/PuLP dependency. Extracted verbatim from ``milp2()``
    so that ``milp2FINAL.py`` holds only the MILP business.

    All calculations are in cycle-ratio units; the two results are converted
    back to seconds before returning.

    Returns ``(bandwidth_outbound_actual, bandwidth_inbound_actual)`` in seconds.
    """
    # Normalize travel times to cycle ratios
    t = np.empty((2, numberofjunctions-1), dtype=float)
    for i in range(numberofjunctions-1):
        t[0, i] = time[0, i] / cycle
        t[1, i] = time[1, i] / cycle

    # Step 1: Find green band coordinates for outbound
    g = np.empty((2, numberofjunctions, 2), dtype=float)

    # First junction outbound
    g[0, 0, 0] = 0
    g[0, 0, 1] = 1 - r[0, 0]

    # Propagate to subsequent junctions
    for i in range(1, numberofjunctions):
        g[0, i, 1] = g[0, i-1, 1] + 0.5*r[0, i-1] + phi[0, i-1] - 0.5*r[0, i]
        g[0, i, 0] = g[0, i, 1] - (1 - r[0, i])

    # Step 2: Find green band coordinates for inbound
    # Special handling for first junction based on delta
    if not delta_new[1, 0]:  # delta_new[1, 0] == 0 (False)
        g[1, 0, 0] = 0 - (cnew_1[0]/cycle - (1 - r[1, 0]))
        g[1, 0, 1] = g[1, 0, 0] + (1 - r[1, 0])
    elif delta_new[1, 0]:  # delta_new[1, 0] == 1 (True)
        g[1, 0, 0] = 0 + (cnew_3[0]/cycle - (1 - r[1, 0]))
        g[1, 0, 1] = g[1, 0, 0] + (1 - r[1, 0])

    # Propagate to subsequent junctions
    for i in range(1, numberofjunctions):
        g[1, i, 1] = g[1, i-1, 1] + 0.5*r[1, i-1] - phi[1, i-1] - 0.5*r[1, i]
        g[1, i, 0] = g[1, i, 1] - (1 - r[1, i])

    # Step 3: Find outbound bandwidth starting coordinates
    b_coord = np.empty((2, numberofjunctions, 2), dtype=float)
    bandspace = np.empty((2, numberofjunctions), dtype=float)

    # First junction outbound - initialize
    b_coord[0, 0, 0] = g[0, 0, 0]
    bandspace[0, 0] = 1 - r[0, 0]

    # Propagate through junctions with gap handling
    for i in range(0, numberofjunctions-1):

        # Case 1: Bandwidth line arrives before next green band starts (gap exists)
        if b_coord[0, i, 0] + t[0, i] < g[0, i+1, 0]:
            gap = g[0, i+1, 0] - b_coord[0, i, 0] - t[0, i]

            # Check if gap is larger than current bandspace minus phaseRed
            if gap > bandspace[0, i] - outRed_final[i] / cycle:
                bandspace[0, i] = 0
                b_coord[0, i+1, 0] = g[0, i+1, 0]
                bandspace[0, i+1] = 1 - r[0, i+1]
            else:
                # Shift current junction forward
                b_coord[0, i, 0] = b_coord[0, i, 0] + gap
                bandspace[0, i] = g[0, i, 1] - outRed_final[i] / cycle - b_coord[0, i, 0]

                # Set next junction
                b_coord[0, i+1, 0] = g[0, i+1, 0]
                bandspace[0, i+1] = 1 - r[0, i+1]

                # Propagate gap backwards to all previous junctions
                if i > 0:
                    for j in range(i-1, -1, -1):
                        if g[0, j, 1] - outRed_final[j] / cycle > b_coord[0, j, 0] + gap:
                            b_coord[0, j, 0] = b_coord[0, j, 0] + gap
                            bandspace[0, j] = g[0, j, 1] - outRed_final[j] / cycle - b_coord[0, j, 0]
                        else:
                            bandspace[0, j] = 0

        # Case 2: Bandwidth line arrives after next green band ends (overshoot)
        elif b_coord[0, i, 0] + t[0, i] > g[0, i+1, 1] - outRed_final[i+1] / cycle:
            bandspace[0, i] = 0
            b_coord[0, i+1, 0] = g[0, i+1, 0]
            bandspace[0, i+1] = 1 - r[0, i+1]

        # Case 3: Normal propagation (bandwidth line fits within next green band)
        else:
            b_coord[0, i+1, 0] = b_coord[0, i, 0] + t[0, i]
            bandspace[0, i+1] = g[0, i+1, 1] - outRed_final[i+1] / cycle - b_coord[0, i+1, 0]

    # Step 4: Find inbound bandwidth starting coordinates
    # Start from last junction
    last_j = numberofjunctions-1
    b_coord[1, last_j, 0] = g[1, last_j, 0]
    bandspace[1, last_j] = 1 - r[1, last_j]

    # Propagate backwards through junctions with gap handling
    for i in range(numberofjunctions-1, 0, -1):

        # Case 1: Bandwidth line arrives before previous green band starts (gap exists)
        if b_coord[1, i, 0] + t[1, i-1] < g[1, i-1, 0]:
            gap = g[1, i-1, 0] - b_coord[1, i, 0] - t[1, i-1]

            # Check if gap is larger than current bandspace minus phaseRed
            if gap > bandspace[1, i] - inRed_final[i] / cycle:
                bandspace[1, i] = 0
                b_coord[1, i-1, 0] = g[1, i-1, 0]
                bandspace[1, i-1] = 1 - r[1, i-1]
            else:
                # Shift current junction forward
                b_coord[1, i, 0] = b_coord[1, i, 0] + gap
                bandspace[1, i] = g[1, i, 1] - inRed_final[i] / cycle - b_coord[1, i, 0]

                # Set previous junction
                b_coord[1, i-1, 0] = g[1, i-1, 0]
                bandspace[1, i-1] = 1 - r[1, i-1]

                # Propagate gap forward to all subsequent junctions
                if i < numberofjunctions-1:
                    for j in range(i+1, numberofjunctions):
                        if g[1, j, 1] - inRed_final[j] / cycle > b_coord[1, j, 0] + gap:
                            b_coord[1, j, 0] = b_coord[1, j, 0] + gap
                            bandspace[1, j] = g[1, j, 1] - inRed_final[j] / cycle - b_coord[1, j, 0]
                        else:
                            bandspace[1, j] = 0

        # Case 2: Bandwidth line arrives after previous green band ends (overshoot)
        elif b_coord[1, i, 0] + t[1, i-1] > g[1, i-1, 1] - inRed_final[i-1] / cycle:
            bandspace[1, i] = 0
            b_coord[1, i-1, 0] = g[1, i-1, 0]
            bandspace[1, i-1] = 1 - r[1, i-1]

        # Case 3: Normal propagation (bandwidth line fits within previous green band)
        else:
            b_coord[1, i-1, 0] = b_coord[1, i, 0] + t[1, i-1]
            bandspace[1, i-1] = g[1, i-1, 1] - inRed_final[i-1] / cycle - b_coord[1, i-1, 0]

    # Step 5: Find actual bandwidth (minimum of all bandspace)
    bandwidth = np.empty(2, dtype=float)
    bandwidth[0] = np.min(bandspace[0])
    bandwidth[1] = np.min(bandspace[1])

    # Step 6: Find ending coordinates, phaseRedCoord, alpha, and beta
    alpha = np.empty((2, numberofjunctions), dtype=float)
    beta = np.empty((2, numberofjunctions), dtype=float)
    phaseRedCoord = np.empty((2, numberofjunctions, 2), dtype=float)

    for i in range(numberofjunctions):
        # Calculate phaseRed coordinates
        phaseRedCoord[0, i, 1] = g[0, i, 1]
        phaseRedCoord[0, i, 0] = phaseRedCoord[0, i, 1] - outRed_final[i] / cycle
        phaseRedCoord[1, i, 1] = g[1, i, 1]
        phaseRedCoord[1, i, 0] = phaseRedCoord[1, i, 1] - inRed_final[i] / cycle

        # Calculate bandwidth ending coordinates
        b_coord[0, i, 1] = b_coord[0, i, 0] + bandwidth[0]
        b_coord[1, i, 1] = b_coord[1, i, 0] + bandwidth[1]

        # Calculate alpha and beta
        alpha[0, i] = b_coord[0, i, 0] - g[0, i, 0]
        alpha[1, i] = b_coord[1, i, 0] - g[1, i, 0]
        beta[0, i] = g[0, i, 1] - b_coord[0, i, 1]
        beta[1, i] = phaseRedCoord[1, i, 0] - b_coord[1, i, 1]

    # Convert bandwidth to seconds for output
    bandwidth_outbound_actual = bandwidth[0] * cycle
    bandwidth_inbound_actual = bandwidth[1] * cycle

    return bandwidth_outbound_actual, bandwidth_inbound_actual
