"""
Overlap and asymmetric barrier detection for the translation layer.

Detects OVL (overlap) phase positions and within-barrier asymmetric
configurations from the junction's inboundIdx/outboundIdx data.
"""


def detect_overlap_positions(junction):
    """
    Detect overlap (OVL) phase positions.

    Uses ovlPhaseIndices from the junction as the authoritative source.
    This prevents asymmetric bridge phases (which also appear in both
    inboundIdx and outboundIdx) from being misclassified as OVL.

    Falls back to the inbound ∩ outbound inference only for old data
    that predates the ovlPhaseIndices field.

    Args:
        junction: Junction dictionary with phaseNames, inboundIdx, outboundIdx,
                  and optionally ovlPhaseIndices

    Returns:
        list: Indices of OVL phases (e.g., [1] or [1, 4])
    """
    ovl = junction.get('ovlPhaseIndices')
    if ovl is not None:
        return sorted(ovl)

    # Fallback for old data without ovlPhaseIndices field
    inbound_indices = set(junction.get('inboundIdx', []))
    outbound_indices = set(junction.get('outboundIdx', []))
    return sorted(list(inbound_indices & outbound_indices))


def detect_asymmetric_barriers(junction, ovl_positions):
    """
    Detect within-barrier asymmetric configurations from inboundIdx/outboundIdx.

    For each barrier b (0 or 1), phases [b*2, b*2+1] are examined.
    A barrier is asymmetric when one phase is exclusive to one direction
    and the other phase appears in BOTH directions (the bridge).

    Patterns detected (p0=b*2, p1=b*2+1):
      - p0=outbound-only + p1=bridge  → asym out, merge at p0
      - p1=outbound-only + p0=bridge  → asym out, merge at p1
      - p0=inbound-only  + p1=bridge  → asym in,  merge at p0
      - p1=inbound-only  + p0=bridge  → asym in,  merge at p1

    The merged ring position absorbs the full barrier total; the bridge
    position gets 0 in that ring.

    Args:
        junction: Junction dictionary
        ovl_positions: List of OVL phase indices (excluded from detection)

    Returns:
        list: Dicts with keys {barrier, dir, merge_at, bridge}
    """
    inbound_set = set(junction.get('inboundIdx', []))
    outbound_set = set(junction.get('outboundIdx', []))
    phases_s = junction.get('phases_s', [])
    ovl_set = set(ovl_positions)
    result = []

    for b in range(2):
        p0, p1 = b * 2, b * 2 + 1
        if p1 >= len(phases_s):
            continue  # barrier incomplete — skip
        if p0 in ovl_set or p1 in ovl_set:
            continue  # barrier contains OVL phase — handled separately

        p0_out = p0 in outbound_set
        p0_in  = p0 in inbound_set
        p1_out = p1 in outbound_set
        p1_in  = p1 in inbound_set

        # p0=outbound-only, p1=bridge → asymmetric outbound, merge at p0
        if (p0_out and not p0_in) and (p1_out and p1_in):
            result.append({'barrier': b, 'dir': 'out', 'merge_at': p0, 'bridge': p1})
        # p1=outbound-only, p0=bridge → asymmetric outbound, merge at p1
        elif (p1_out and not p1_in) and (p0_out and p0_in):
            result.append({'barrier': b, 'dir': 'out', 'merge_at': p1, 'bridge': p0})
        # p0=inbound-only, p1=bridge → asymmetric inbound, merge at p0
        elif (p0_in and not p0_out) and (p1_in and p1_out):
            result.append({'barrier': b, 'dir': 'in', 'merge_at': p0, 'bridge': p1})
        # p1=inbound-only, p0=bridge → asymmetric inbound, merge at p1
        elif (p1_in and not p1_out) and (p0_in and p0_out):
            result.append({'barrier': b, 'dir': 'in', 'merge_at': p1, 'bridge': p0})

    return result
