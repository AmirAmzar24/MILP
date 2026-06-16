import logging
import numpy as np
from pulp import *
from check_constraint import check_coordination_constraint
from actual_bandwidth import compute_actual_bandwidth

logger = logging.getLogger(__name__)


def _match_pos(phaseID, phase_id, i):
    """Position of junction *i*'s coordinated phase within a global phaseID array.

    Replicates a load-bearing idiom repeated ~40 times across milp2/callback:

        arr[i][np.where(phaseID == phase_id)[1][i]][np.where(phaseID == phase_id)[2][i]]

    The np.where search runs over the WHOLE 3-D ``phaseID`` array (not the
    per-junction slice ``phaseID[i]``); the i-th match across that global,
    row-major search is taken to belong to junction *i*. Returns the
    ``(ring, slot)`` index pair to use as ``arr[i][ring][slot]``.
    """
    match = np.where(phaseID == phase_id)
    return match[1][i], match[2][i]


# ─ Phase-rearrangement layout tables (Phase 3: table-driven _rearrange_phases) ─
# The optimiser's chosen coordinated phases must land in fixed NEMA slots, with
# the remaining phases filling the rest of the 2-ring × 4-position grid. Instead
# of spelling that out once per (flag, pattern, group) — the ~1100-line copy-paste
# this replaces — we drive it from two small tables.
#
# Roles within a coordinated pair (timing/red/amber come from different sources):
#   "O"  outbound          — values from the passed-in out* scalars
#   "Ob" ringBarrier[out]  — values from the per-junction phase_to_* lookup
#   "I"  inbound           — values from the passed-in in* scalars
#   "Ib" ringBarrier[in]   — values from the phase_to_* lookup

# Group of the outbound phase -> ring/position layout for that junction:
#   out_ring/in_ring : rings holding the outbound / inbound coordinated pairs
#   coord_base       : the pair occupies positions (coord_base, coord_base+1)
#   leftover_base    : non-coordinated phases fill (leftover_base, leftover_base+1)
_GROUP_LAYOUT = {
    (1, 2): dict(out_ring=0, in_ring=1, coord_base=0, leftover_base=2),
    (5, 6): dict(out_ring=1, in_ring=0, coord_base=0, leftover_base=2),
    (3, 4): dict(out_ring=0, in_ring=1, coord_base=2, leftover_base=0),
    (7, 8): dict(out_ring=1, in_ring=0, coord_base=2, leftover_base=0),
}

# Lead/lag pattern (δ₀, δ₁) -> role order [role at coord_base, role at coord_base+1]
# for each ring. Which of O/Ob (and I/Ib) leads within the pair is the entire
# lead-vs-lag distinction.
_PATTERN_LAYOUT = {
    (0, 1): dict(out_order=("O", "Ob"), in_order=("Ib", "I")),   # leading
    (1, 0): dict(out_order=("Ob", "O"), in_order=("I", "Ib")),   # lagging
    (0, 0): dict(out_order=("Ob", "O"), in_order=("Ib", "I")),   # lead-lead
    (1, 1): dict(out_order=("O", "Ob"), in_order=("I", "Ib")),   # lag-lag
}


def _rearrange_phases(
        phaseID, phasenew, phaseRednew, phaseAmbernew,
        outbound, inbound, numberofjunctions, delta_new, flag,
        ringBarrier, outphase, inphase, outRed, inRed, outAmber, inAmber
):
    """Rearrange phase arrays post-optimization so each junction's coordination
    phases sit in the positions the MILP output path expects.
    Returns (phaseID_new, phasenewer, phaseRednewer, phaseAmbernewer).

    Table-driven (see _GROUP_LAYOUT / _PATTERN_LAYOUT):
      * flag==0 rearranges nothing (returns the inputs unchanged).
      * flag==1 handles leading/lagging only; flag==2 handles all four patterns.
      * both write amber on every placed phase (coordinated and leftover). The
        flag==2 amber gaps that used to exist (lead-lead wrote none; leftovers
        never got amber) were an unfinished feature, now standardised to match
        flag 0/1 — see docs/MILP2_REFACTOR_PLAN.md.
    """
    # Create new arrays as copies of the originals
    phaseID_new = phaseID.copy()
    phasenewer = phasenew.copy()
    phaseRednewer = phaseRednew.copy()
    phaseAmbernewer = phaseAmbernew.copy()

    if flag not in (1, 2):
        return phaseID_new, phasenewer, phaseRednewer, phaseAmbernewer

    # flag==1 only ever sees leading/lagging (the solver restricts it to those);
    # flag==2 can see all four.
    handled = {(0, 1), (1, 0)} if flag == 1 else {(0, 1), (1, 0), (0, 0), (1, 1)}

    for i in range(numberofjunctions):
        # Build into fresh zero arrays, then assign back — an unmatched junction
        # (e.g. flag==1 with a same-column pattern) stays all-zero, as before.
        temp_phaseID = np.zeros_like(phaseID[i])
        temp_phasenew = np.zeros_like(phasenew[i])
        temp_phaseRednew = np.zeros_like(phaseRednew[i])
        temp_phaseAmbernew = np.zeros_like(phaseAmbernew[i])

        pattern = (int(delta_new[0, i]), int(delta_new[1, i]))
        out_id = outbound[i]
        group = next((g for g in _GROUP_LAYOUT if out_id in g), None)

        if pattern in handled and group is not None:
            # Per-junction phase -> timing/red/amber over the ORIGINAL grid.
            ptt, ptr, pta = {}, {}, {}
            for ring in range(2):
                for position in range(4):
                    p = phaseID[i][ring][position]
                    ptt[p] = phasenew[i][ring][position]
                    ptr[p] = phaseRednew[i][ring][position]
                    pta[p] = phaseAmbernew[i][ring][position]

            ob_id = ringBarrier[out_id]
            in_id = inbound[i]
            ib_id = ringBarrier[in_id]
            # role -> (phase_id, timing, red, amber)
            role_val = {
                "O":  (out_id, outphase[i], outRed[i], outAmber[i]),
                "Ob": (ob_id, ptt[ob_id], ptr[ob_id], pta[ob_id]),
                "I":  (in_id, inphase[i], inRed[i], inAmber[i]),
                "Ib": (ib_id, ptt[ib_id], ptr[ib_id], pta[ib_id]),
            }

            layout = _GROUP_LAYOUT[group]
            order = _PATTERN_LAYOUT[pattern]
            base = layout["coord_base"]

            # Place the outbound and inbound coordinated pairs.
            for ring, roles in ((layout["out_ring"], order["out_order"]),
                                (layout["in_ring"], order["in_order"])):
                for k, role in enumerate(roles):
                    pid, timing, red, amber = role_val[role]
                    temp_phaseID[ring][base + k] = pid
                    temp_phasenew[ring][base + k] = timing
                    temp_phaseRednew[ring][base + k] = red
                    temp_phaseAmbernew[ring][base + k] = amber

            # Place leftover (non-coordinated) phases: ring-1 phases (<=4) into
            # ring 0, ring-2 phases (>=5) into ring 1, both from leftover_base.
            all_phases = [phaseID[i][ring][position]
                          for ring in range(2) for position in range(4)]
            key_phases = [out_id, ob_id, in_id, ib_id]
            remaining = [p for p in all_phases if p not in key_phases]
            lb = layout["leftover_base"]
            for ring, phases in ((0, [p for p in remaining if p <= 4]),
                                 (1, [p for p in remaining if p >= 5])):
                for idx, p in enumerate(phases):
                    pos = lb + idx
                    if pos < lb + 2:
                        temp_phaseID[ring][pos] = p
                        temp_phasenew[ring][pos] = ptt[p]
                        temp_phaseRednew[ring][pos] = ptr[p]
                        temp_phaseAmbernew[ring][pos] = pta[p]

        if flag == 1 and np.all(temp_phaseID == 0):
            logger.warning("Junction %d temp_phaseID is ALL ZEROS: outbound=%s delta[0]=%s delta[1]=%s",
                           i, outbound[i], delta_new[0, i], delta_new[1, i])

        # Assign the temporary arrays back to our result arrays
        phaseID_new[i] = temp_phaseID
        phasenewer[i] = temp_phasenew
        phaseRednewer[i] = temp_phaseRednew
        phaseAmbernewer[i] = temp_phaseAmbernew

    return phaseID_new, phasenewer, phaseRednewer, phaseAmbernewer


def _build_model(numberofjunctions, c1, c2, k, r, l, d, speedRange, speedChangeRange,
                 tao, flag, lead_lag_status, suppress_outbound, suppress_inbound):
    """Construct the MILP: decision variables, objective, and every constraint
    family. Returns the problem plus the variable bundles the caller reads the
    solution from: (maxband, b_var, z, w, t, delta, m_var)."""
    maxband = LpProblem("MILP2", LpMaximize)
    e = np.array(speedRange)[:, :, 0]  # Lower limit of speed
    f = np.array(speedRange)[:, :, 1]  # Upper limit of speed
    g = np.array(speedChangeRange)[:, :, 1]  # Upper limit of change in reciprocal speed
    h = np.array(speedChangeRange)[:, :, 0]  # Lower limit of change in reciprocal speed
    # Decision variables
    b_var = [LpVariable(f"b_{i}", 0, 1) for i in range(2)]  # b[0]=outbound bandwidth, b[1]=inbound bandwidth
    z = LpVariable("z", 1/c2, 1/c1)  # z = signal frequency (1/cycle length)
    w = [[LpVariable(f"w_{i}_{j}", 0, 1) for j in range(numberofjunctions)] for i in range(2)]  # Timing variables
    t = [[LpVariable(f"t_{i}_{j}", 0, None) for j in range(numberofjunctions-1)] for i in range(2)]  # Travel times between junctions
    delta = [[LpVariable(f"delta_{i}_{j}", cat=LpBinary) for j in range(numberofjunctions)] for i in range(2)]  # Binary pattern variables
    m_var = [LpVariable(f"m_{i}", 0, None, LpInteger) for i in range(numberofjunctions)]  # Integer offset variables

    # Objective function: maximize b₀ + k·b₁
    maxband += b_var[0] + k*b_var[1]

    # Priority constraint: b₁ = k * b₀
    # Skipped in one-way mode: the suppressed direction has b=0 already enforced
    # by the bandwidth constraint (r=1 when green=0). Adding the priority constraint
    # on top would force the active direction's bandwidth to 0 as well.
    if not suppress_outbound and not suppress_inbound:
        if k == 1:
            maxband += b_var[0] == b_var[1], "priority_con"
        else:
            maxband += (1-k)*b_var[1] == (1-k)*k*b_var[0], "priority_con"

    # One-way mode: explicitly pin the suppressed direction's bandwidth and all
    # its travel time variables to 0 so they do not pollute the coordination constraint.
    if suppress_outbound:
        logger.info("[ONE-WAY] Outbound suppressed — fixing b_out=0 and t_out=0 for all segments")
        maxband += b_var[0] == 0, "oneway_b_out"
        for i in range(numberofjunctions - 1):
            maxband += t[0][i] == 0, f"oneway_t_out_{i}"
    if suppress_inbound:
        logger.info("[ONE-WAY] Inbound suppressed — fixing b_in=0 and t_in=0 for all segments")
        maxband += b_var[1] == 0, "oneway_b_in"
        for i in range(numberofjunctions - 1):
            maxband += t[1][i] == 0, f"oneway_t_in_{i}"

    # Bandwidth constraints for outbound direction: w₀,ᵢ + b₀ ≤ 1 - r₀,ᵢ
    for i in range(numberofjunctions):
        maxband += w[0][i] + b_var[0] <= 1 - r[0, i], f"bw_out_{i}"

    # Bandwidth constraints for inbound direction: w₁,ᵢ + b₁ ≤ 1 - r₁,ᵢ
    for i in range(numberofjunctions):
        maxband += w[1][i] + b_var[1] <= 1 - r[1, i], f"bw_in_{i}"

    # Coordination constraint:
    # (w₁,ᵢ + w₀,ᵢ) - (w₁,ᵢ₊₁ + w₀,ᵢ₊₁) + (t₀,ᵢ + t₁,ᵢ) + δ₀,ᵢl₀,ᵢ - δ₁,ᵢl₁,ᵢ - δ₀,ᵢ₊₁l₀,ᵢ₊₁ + δ₁,ᵢ₊₁l₁,ᵢ₊₁ - mᵢ = (r₀,ᵢ₊₁ - r₀,ᵢ) + (τ₀,ᵢ₊₁ + τ₁,ᵢ)
    # Outbound-biased coordination (k <= 1: outbound priority or equal)
    for i in range(numberofjunctions-1):
        maxband += ((w[1][i] + w[0][i]) - (w[1][i+1] + w[0][i+1]) + (t[0][i] + t[1][i])
                + delta[0][i] * l[0, i] - delta[1][i] * l[1,i] - delta[0][i+1] * l[0, i+1]
                + delta[1][i+1] * l[1, i+1] - m_var[i]
                == (r[0, i+1] - r[0, i]) + (tao[0, i+1] + tao[1, i])), f"coord_{i}"
    # Travel time upper bounds for outbound: t₀,ᵢ ≤ (d₀,ᵢ/e₀,ᵢ)·z
    # Skipped when outbound is suppressed — t_out is already fixed to 0 above.
    if not suppress_outbound:
        for i in range(numberofjunctions-1):
            maxband += t[0][i] <= (d[0, i]/e[0, i])*z, f"t_up_out_{i}"

        # Travel time lower bounds for outbound: t₀,ᵢ ≥ (d₀,ᵢ/f₀,ᵢ)·z
        for i in range(numberofjunctions-1):
            maxband += t[0][i] >= (d[0, i]/f[0, i])*z, f"t_low_out_{i}"

        # Speed change upper bound for outbound: (d₀,ᵢ/d₀,ᵢ₊₁)·t₀,ᵢ₊₁ - t₀,ᵢ ≤ (d₀,ᵢ/g₀,ᵢ)·z
        for i in range(numberofjunctions-2):
            maxband += (d[0, i]/d[0, i+1]) * t[0][i+1] - t[0][i] <= (d[0, i]/g[0, i]) * z, f"s_up_out_{i}"

        # Speed change lower bound for outbound: (d₀,ᵢ/d₀,ᵢ₊₁)·t₀,ᵢ₊₁ - t₀,ᵢ ≥ (d₀,ᵢ/h₀,ᵢ)·z
        for i in range(numberofjunctions-2):
            maxband += (d[0, i]/d[0, i+1]) * t[0][i+1] - t[0][i] >= (d[0, i]/h[0, i]) * z, f"s_low_out_{i}"

    # Travel time upper bounds for inbound: t₁,ᵢ ≤ (d₁,ᵢ/e₁,ᵢ)·z
    # Skipped when inbound is suppressed — t_in is already fixed to 0 above.
    if not suppress_inbound:
        for i in range(numberofjunctions-1):
            maxband += t[1][i] <= (d[1, i]/e[1, i]) * z, f"t_up_in_{i}"

        # Travel time lower bounds for inbound: t₁,ᵢ ≥ (d₁,ᵢ/f₁,ᵢ)·z
        for i in range(numberofjunctions-1):
            maxband += t[1][i] >= (d[1, i]/f[1, i]) * z, f"t_low_in_{i}"

        # Speed change upper bound for inbound: (d₁,ᵢ/d₁,ᵢ₊₁)·t₁,ᵢ₊₁ - t₁,ᵢ ≤ (d₁,ᵢ/g₁,ᵢ)·z
        for i in range(numberofjunctions-2):
            maxband += (d[1, i]/d[1, i+1]) * t[1][i+1] - t[1][i] <= (d[1, i]/g[1, i]) * z, f"s_up_in_{i}"

        # Speed change lower bound for inbound: (d₁,ᵢ/d₁,ᵢ₊₁)·t₁,ᵢ₊₁ - t₁,ᵢ ≥ (d₁,ᵢ/h₁,ᵢ)·z
        for i in range(numberofjunctions-2):
            maxband += (d[1, i]/d[1, i+1]) * t[1][i+1] - t[1][i] >= (d[1, i]/h[1, i]) * z, f"s_low_in_{i}"
    
    #choose to not change the pattern
    if flag == 0:
      for i in range(numberofjunctions):
        if lead_lag_status[i] == "leading": # Pattern 1: Leading phases - δ₀,ᵢ=0, δ₁,ᵢ=1
           maxband += delta[0][i] == 0, f"pattern_d0_{i}"
           maxband += delta[1][i] == 1, f"pattern_d1_{i}"
        elif lead_lag_status[i] == "lagging": # Pattern 2: Lagging phases - δ₀,ᵢ=1, δ₁,ᵢ=0
           maxband += delta[0][i] == 1, f"pattern_d0_{i}"
           maxband += delta[1][i] == 0, f"pattern_d1_{i}"
        elif lead_lag_status[i] == "lead-lead": # Pattern 3: Lead-lead - δ₀,ᵢ=0, δ₁,ᵢ=0
           maxband += delta[0][i] == 0, f"pattern_d0_{i}"
           maxband += delta[1][i] == 0, f"pattern_d1_{i}"
        else:
           maxband += delta[0][i] == 1, f"pattern_d0_{i}" # Pattern 4: Lag-lag - δ₀,ᵢ=1, δ₁,ᵢ=1
           maxband += delta[1][i] == 1, f"pattern_d1_{i}"

    # Restrict to patterns 1 and 2 only: Either outbound or inbound has a leading phase
    elif flag == 1:
       for i in range(numberofjunctions):
           maxband += delta[0][i] + delta[1][i] == 1, f"pattern_12_{i}"
    return maxband, b_var, z, w, t, delta, m_var


def _solve_and_check(maxband, w, t, delta, m_var, r, tao, l, numberofjunctions):
    """Solve with HiGHS and validate; raise ValueError on any non-optimal status.
    On success, re-verifies the coordination constraint."""
    # Solve with HiGHS
    solver = HiGHS(msg=False)
    maxband.solve(solver)

    # Check optimization status and quality
    logger.info("Optimization status: %s", LpStatus[maxband.status])
    if maxband.status == LpStatusOptimal:
        logger.info("OPTIMAL solution found — objective (max bandwidth): %s", value(maxband.objective))
        check_coordination_constraint(w, t, delta, m_var, r, tao, l, numberofjunctions)
    elif maxband.status == LpStatusInfeasible:
        raise ValueError("Optimization failed: problem is infeasible. Check that cycle range, speed range, and phase timing constraints are compatible.")
    elif maxband.status == LpStatusUnbounded:
        raise ValueError("Optimization failed: problem is unbounded. Check input constraints.")
    else:
        raise ValueError(f"Optimization failed with status: {LpStatus[maxband.status]}")


def _balance_cycle_lengths(phasenewer, phaseID_new, outbound, inbound, ringBarrier, numberofjunctions, cycle):
    """Barrier-balance each junction so both rings sum to the cycle length.
    Mutates phasenewer in place; returns (cnew_1, cnew_3) — the barrier-1 ring
    sums the bandwidth geometry needs."""
    ncycle = np.zeros((2, phasenewer.shape[0]))
    for i in range(phasenewer.shape[0]):
       ncycle[0, i] = np.sum(phasenewer[i, 0])
       ncycle[1, i] = np.sum(phasenewer[i, 1])

    tjunction = np.zeros(phasenewer.shape[0], dtype=bool)
    for i in range(phasenewer.shape[0]):
       if np.any(phasenewer[i] == 0):
           tjunction[i] = True

    cnew_1 = np.empty(numberofjunctions, dtype = int)
    cnew_2 = np.empty(numberofjunctions, dtype = int)
    cnew_3 = np.empty(numberofjunctions, dtype = int)
    cnew_4 = np.empty(numberofjunctions, dtype = int)

    for i in range(phasenewer.shape[0]):

        cnew_1[i]=phasenewer[i, 0, 0]+phasenewer[i, 0, 1]
        cnew_2[i]=phasenewer[i, 0, 2]+phasenewer[i, 0, 3]
        cnew_3[i]=phasenewer[i, 1, 0]+phasenewer[i, 1, 1]
        cnew_4[i]=phasenewer[i, 1, 2]+phasenewer[i, 1, 3]
        
        if not tjunction[i] and (ncycle[0, i] < cycle or ncycle[1, i] < cycle):
            if ncycle[0, i] < cycle and ncycle[1, i] < cycle:
                # DEBUG: Print info about the np.where search
                search_result = np.where(phaseID_new == outbound[i])
                logger.debug("Junction %d outbound=%s matches=%d", i, outbound[i], len(search_result[0]))
                if len(search_result[0]) <= i:
                    logger.error("Not enough phaseID matches for junction %d outbound=%s", i, outbound[i])
                    for j in range(numberofjunctions):
                        logger.error("  Junction %d: %s has %s? %s", j, phaseID_new[j].tolist(), outbound[i], outbound[i] in phaseID_new[j])
                out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                phasenewer[i][out_r][out_s] += (cycle-ncycle[0, i])
                phasenewer[i][in_r][in_s] += (cycle-ncycle[0, i])
            else:
                if ncycle[0, i] < cycle:
                    if outbound[i] in phaseID_new[i, 0]:
                        out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                        phasenewer[i][out_r][out_s] += (cycle-ncycle[0, i])
                    else:
                        in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                        phasenewer[i][in_r][in_s] += (cycle-ncycle[0, i])

                else:
                    if outbound[i] in phaseID_new[i, 1]:
                        out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                        phasenewer[i][out_r][out_s] += (cycle-ncycle[1, i])
                    else:
                        in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                        phasenewer[i][in_r][in_s] += (cycle-ncycle[1, i])

        if not tjunction[i] and (ncycle[0, i] > cycle or ncycle[1, i] > cycle):
            if ncycle[0, i] > cycle and ncycle[1, i] > cycle:
                out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                phasenewer[i][out_r][out_s] += (cycle-ncycle[0, i])
                phasenewer[i][in_r][in_s] += (cycle-ncycle[0, i])

            else:
                if ncycle[0, i] > cycle:
                    if outbound[i] in phaseID_new[i, 0]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cycle-ncycle[0, i])

                    else:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cycle-ncycle[0, i])

                else:
                    if outbound[i] in phaseID_new[i, 1]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cycle-ncycle[1, i])
                    else:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cycle-ncycle[1, i])
        if tjunction[i]:
            if ncycle[0, i] == cycle:
                if cnew_1[i] < cnew_3[i]:
                    if outbound[i] in phaseID_new[i, 1]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cnew_1[i]-cnew_3[i])
                    elif inbound[i] in phaseID_new[i, 1]:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cnew_1[i]-cnew_3[i])

                elif cnew_2[i] < cnew_4[i]:
                    if outbound[i] in phaseID_new[i, 1]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cnew_2[i]-cnew_4[i])
                    elif inbound[i] in phaseID_new[i, 1]:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cnew_2[i]-cnew_4[i])

            elif ncycle[1, i] == cycle:
                if cnew_3[i] < cnew_1[i]:
                    if outbound[i] in phaseID_new[i, 0]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cnew_3[i]-cnew_1[i])
                    elif inbound[i] in phaseID_new[i, 0]:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cnew_3[i]-cnew_1[i])

                elif cnew_4[i] < cnew_2[i]:
                    if outbound[i] in phaseID_new[i, 0]:
                        out_r, out_s = _match_pos(phaseID_new, ringBarrier[outbound[i]], i)
                        phasenewer[i][out_r][out_s] += (cnew_4[i]-cnew_2[i])
                    elif inbound[i] in phaseID_new[i, 0]:
                        in_r, in_s = _match_pos(phaseID_new, ringBarrier[inbound[i]], i)
                        phasenewer[i][in_r][in_s] += (cnew_4[i]-cnew_2[i])
    
    for i in range(phasenewer.shape[0]):
        ncycle[0, i] = np.sum(phasenewer[i, 0])
        ncycle[1, i] = np.sum(phasenewer[i, 1])

    for i in range(phasenewer.shape[0]):
        cnew_1[i]=phasenewer[i, 0, 0]+phasenewer[i, 0, 1]
        cnew_2[i]=phasenewer[i, 0, 2]+phasenewer[i, 0, 3]
        cnew_3[i]=phasenewer[i, 1, 0]+phasenewer[i, 1, 1]
        cnew_4[i]=phasenewer[i, 1, 2]+phasenewer[i, 1, 3]
        
        # T-junction barrier balancing: ensure cnew_1 == cnew_3 and cnew_2 == cnew_4
        if tjunction[i]:
            # Balance barrier 1 (phases 1,2 vs 5,6)
            diff_barrier1 = cnew_1[i] - cnew_3[i]
            if abs(diff_barrier1) > 0.01:
                if diff_barrier1 > 0:  # cnew_1 > cnew_3, need to add time to ring 2 barrier 1
                    # Find non-zero phases in ring 2, barrier 1 (positions [1,0] and [1,1])
                    if phasenewer[i, 1, 0] > 0:  # Phase at ring 2, position 0 exists
                        phasenewer[i, 1, 0] += diff_barrier1
                    elif phasenewer[i, 1, 1] > 0:  # Phase at ring 2, position 1 exists
                        phasenewer[i, 1, 1] += diff_barrier1
                else:  # cnew_3 > cnew_1, need to add time to ring 1 barrier 1
                    # Find non-zero phases in ring 1, barrier 1 (positions [0,0] and [0,1])
                    if phasenewer[i, 0, 0] > 0:  # Phase at ring 1, position 0 exists
                        phasenewer[i, 0, 0] += abs(diff_barrier1)
                    elif phasenewer[i, 0, 1] > 0:  # Phase at ring 1, position 1 exists
                        phasenewer[i, 0, 1] += abs(diff_barrier1)
            
            # Balance barrier 2 (phases 3,4 vs 7,8)
            diff_barrier2 = cnew_2[i] - cnew_4[i]
            if abs(diff_barrier2) > 0.01:
                if diff_barrier2 > 0:  # cnew_2 > cnew_4, need to add time to ring 2 barrier 2
                    # Find non-zero phases in ring 2, barrier 2 (positions [1,2] and [1,3])
                    if phasenewer[i, 1, 2] > 0:  # Phase at ring 2, position 2 exists
                        phasenewer[i, 1, 2] += diff_barrier2
                    elif phasenewer[i, 1, 3] > 0:  # Phase at ring 2, position 3 exists
                        phasenewer[i, 1, 3] += diff_barrier2
                else:  # cnew_4 > cnew_2, need to add time to ring 1 barrier 2
                    # Find non-zero phases in ring 1, barrier 2 (positions [0,2] and [0,3])
                    if phasenewer[i, 0, 2] > 0:  # Phase at ring 1, position 2 exists
                        phasenewer[i, 0, 2] += abs(diff_barrier2)
                    elif phasenewer[i, 0, 3] > 0:  # Phase at ring 1, position 3 exists
                        phasenewer[i, 0, 3] += abs(diff_barrier2)
            
            # Recalculate cnew values after balancing
            cnew_1[i]=phasenewer[i, 0, 0]+phasenewer[i, 0, 1]
            cnew_2[i]=phasenewer[i, 0, 2]+phasenewer[i, 0, 3]
            cnew_3[i]=phasenewer[i, 1, 0]+phasenewer[i, 1, 1]
            cnew_4[i]=phasenewer[i, 1, 2]+phasenewer[i, 1, 3]
        
        if not tjunction[i] and (ncycle[0, i] == cycle or ncycle[1, i] == cycle):
            if cnew_1[i] > cnew_3[i]:
                if outbound[i] in phaseID_new[i, 1]:
                    out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                    phasenewer[i][out_r][out_s] += (cnew_1[i]-cnew_3[i])
                    phasenewer[i, 1, 2] += (cnew_3[i]- cnew_1[i])
                elif inbound[i] in phaseID_new[i, 1]:
                    in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                    phasenewer[i][in_r][in_s] += (cnew_1[i]-cnew_3[i])
                    phasenewer[i, 1, 2] += (cnew_3[i]- cnew_1[i])
                cnew_1[i]=phasenewer[i, 0, 0]+phasenewer[i, 0, 1]
                cnew_3[i]=phasenewer[i, 1, 0]+phasenewer[i, 1, 1]

            elif cnew_3[i] > cnew_1[i]:
                if outbound[i] in phaseID_new[i, 0]:
                    out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                    phasenewer[i][out_r][out_s] += (cnew_3[i]-cnew_1[i])
                    phasenewer[i, 0, 2] += (cnew_1[i]- cnew_3[i])
                elif inbound[i] in phaseID_new[i, 0]:
                    in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                    phasenewer[i][in_r][in_s] += (cnew_3[i]-cnew_1[i])
                    phasenewer[i, 0, 2] += (cnew_1[i]- cnew_3[i])
                cnew_1[i]=phasenewer[i, 0, 0]+phasenewer[i, 0, 1]
                cnew_3[i]=phasenewer[i, 1, 0]+phasenewer[i, 1, 1]

            elif cnew_2[i] > cnew_4[i]:
                if outbound[i] in phaseID_new[i, 1]:
                    out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                    phasenewer[i][out_r][out_s] += (cnew_2[i]-cnew_4[i])
                    phasenewer[i, 1, 0] += (cnew_4[i]- cnew_2[i])
                elif inbound[i] in phaseID_new[i, 1]:
                    in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                    phasenewer[i][in_r][in_s] += (cnew_2[i]-cnew_4[i])
                    phasenewer[i, 1, 0] += (cnew_4[i]- cnew_2[i])
                cnew_2[i]=phasenewer[i, 0, 2]+phasenewer[i, 0, 3]
                cnew_4[i]=phasenewer[i, 1, 2]+phasenewer[i, 1, 3]

            elif cnew_4[i] > cnew_2[i]:
                if outbound[i] in phaseID_new[i, 0]:
                    out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
                    phasenewer[i][out_r][out_s] += (cnew_4[i]-cnew_2[i])
                    phasenewer[i, 0, 0] += (cnew_2[i]- cnew_4[i])
                elif inbound[i] in phaseID_new[i, 0]:
                    in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
                    phasenewer[i][in_r][in_s] += (cnew_4[i]-cnew_2[i])
                    phasenewer[i, 0, 0] += (cnew_2[i]- cnew_4[i])
                cnew_2[i]=phasenewer[i, 0, 2]+phasenewer[i, 0, 3]
                cnew_4[i]=phasenewer[i, 1, 2]+phasenewer[i, 1, 3]
    return cnew_1, cnew_3


def milp2(numberofjunctions, cycleRange, k, r, rightturntime, distance, speedRange, speedChangeRange, tao, lead_lag_status, phase, phaseRed, phaseAmber, flag, phaseID, outbound, inbound, cycle_lengths=None, suppress_outbound=False, suppress_inbound=False):
    # Note: cycle_lengths parameter is kept for backward compatibility but is no longer used
    # All input parameters are already normalized by the callback function

    numberofjunctions=len(phase)
    c1 = cycleRange[0] # Lower limit of cycle length
    c2 = cycleRange[1] # Upper limit of cycle length
    k = k  # Weighting factor between outbound and inbound directions
    r= np.array(r)  # Red time ratios
    l= rightturntime  # Right turn time
    d = distance  # Distance between junctions
    tao = np.array(tao)  # Queue clearance time

    maxband, b_var, z, w, t, delta, m_var = _build_model(
        numberofjunctions, c1, c2, k, r, l, d, speedRange, speedChangeRange,
        tao, flag, lead_lag_status, suppress_outbound, suppress_inbound)

    _solve_and_check(maxband, w, t, delta, m_var, r, tao, l, numberofjunctions)

    # Log all decision variables at DEBUG level for diagnostics
    cycle_opt = round(1 / value(z)) if value(z) else 0
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug("=== MILP2 Variables After Optimization ===")
        logger.debug("b[0] outbound bw = %.6f -> %.2f s", value(b_var[0]), value(b_var[0]) * cycle_opt)
        logger.debug("b[1] inbound  bw = %.6f -> %.2f s", value(b_var[1]), value(b_var[1]) * cycle_opt)
        logger.debug("z (1/cycle)      = %.6f -> cycle = %d s", value(z), cycle_opt)
        for i in range(numberofjunctions):
            logger.debug("w[0][%d]=%.6f  w[1][%d]=%.6f", i, value(w[0][i]), i, value(w[1][i]))
        for i in range(numberofjunctions - 1):
            t0, t1 = value(t[0][i]), value(t[1][i])
            logger.debug("t[0][%d]=%.6f (%.2fs)  t[1][%d]=%.6f (%.2fs)", i, t0, t0*cycle_opt, i, t1, t1*cycle_opt)
        for i in range(numberofjunctions):
            logger.debug("delta[0][%d]=%d  delta[1][%d]=%d", i, int(round(value(delta[0][i]))), i, int(round(value(delta[1][i]))))
        for i in range(numberofjunctions - 1):
            logger.debug("m[%d]=%.0f  r[0][%d]=%.6f  r[1][%d]=%.6f", i, value(m_var[i]), i, r[0,i], i, r[1,i])

    phi = np.empty((2, numberofjunctions-1), dtype=float)
    offset = np.empty((numberofjunctions-1), dtype=float)

    z_val = value(z)
    if z_val is None or z_val == 0:
        raise ValueError("Optimization produced invalid frequency (z=0). Check that cycle range constraints are feasible.")
    cycle = round(1/z_val)

    # ─── STEP: rescale phases to the optimal cycle, extract the coordinated ───
    # phase values, then reorder each junction into NEMA layout. (Interwoven —
    # these share ~14 locals, so they stay inline rather than over-parameterised
    # helpers; see _build_model / _balance_cycle_lengths for the clean cuts.)
    # Scale phases by optimal cycle to get optimized phase values
    phasenew = np.round(phase * cycle)
    phaseRednew = np.round(phaseRed)  # Keep as absolute values, don't scale with cycle
    phaseAmbernew = np.round(phaseAmber)  # Keep as absolute values, don't scale with cycle
    # Extract optimized phase timing values for coordinated phases
    ringBarrier = dict([(1, 2), (2, 1), (3, 4), (4, 3), (5, 6), (6, 5), (7, 8), (8, 7)])
    outphase_optimal = np.empty(numberofjunctions, dtype=int)
    inphase_optimal = np.empty(numberofjunctions, dtype=int)
    outRed_optimal = np.empty(numberofjunctions, dtype=int)
    inRed_optimal = np.empty(numberofjunctions, dtype=int)
    outAmber_optimal = np.empty(numberofjunctions, dtype=int)
    inAmber_optimal = np.empty(numberofjunctions, dtype=int)

    for i in range(numberofjunctions):
        # Find positions using the same indexing pattern as callback
        # Search entire phaseID array and use [1][i] and [2][i] to get i-th match
        out_r, out_s = _match_pos(phaseID, outbound[i], i)
        in_r, in_s = _match_pos(phaseID, inbound[i], i)
        outphase_optimal[i] = phasenew[i][out_r][out_s]
        inphase_optimal[i] = phasenew[i][in_r][in_s]
        outRed_optimal[i] = phaseRednew[i][out_r][out_s]
        inRed_optimal[i] = phaseRednew[i][in_r][in_s]
        outAmber_optimal[i] = phaseAmbernew[i][out_r][out_s]
        inAmber_optimal[i] = phaseAmbernew[i][in_r][in_s]

    time=np.empty((2, numberofjunctions), dtype = float)
    for i in range(numberofjunctions-1):
      time[0, i] = value(t[0][i]) * cycle
      time[1, i] = value(t[1][i]) * cycle

    speed=np.empty((2, numberofjunctions), dtype = float)
    for i in range(numberofjunctions-1):
      # One-way mode: t is fixed to 0 for the suppressed direction, so d/(t*cycle)
      # would be NaN or inf. Return 0 as a sentinel — the direction has no travel.
      t_out_val = value(t[0][i])
      t_in_val  = value(t[1][i])
      speed[0, i] = 0.0 if (suppress_outbound or t_out_val == 0) else (d[0, i] / (t_out_val * cycle)) * 3600/1000
      speed[1, i] = 0.0 if (suppress_inbound  or t_in_val  == 0) else (d[1, i] / (t_in_val  * cycle)) * 3600/1000

    # phasenew and phaseRednew already calculated earlier (line 161-162)
    # ringBarrier already defined earlier (line 165)

    delta_new = np.empty((2, numberofjunctions), dtype=bool)
    for i in range(numberofjunctions):
       raw_delta0 = value(delta[0][i])
       raw_delta1 = value(delta[1][i])
       # Round to handle numerical tolerance from solver (e.g., 2.68e-14 -> 0, 0.9999... -> 1)
       delta_new[0, i] = round(raw_delta0)
       delta_new[1, i] = round(raw_delta1)

    outphase = np.empty(numberofjunctions, dtype=int)
    inphase = np.empty(numberofjunctions, dtype=int)
    outRight = np.empty(numberofjunctions, dtype=int)
    inRight = np.empty(numberofjunctions, dtype=int)

    outRed = np.empty(numberofjunctions, dtype=int)
    inRed = np.empty(numberofjunctions, dtype=int)
    outredRight = np.empty(numberofjunctions, dtype=int)
    inredRight = np.empty(numberofjunctions, dtype=int)
    outAmber = np.empty(numberofjunctions, dtype=int)
    inAmber = np.empty(numberofjunctions, dtype=int)
    outamberRight = np.empty(numberofjunctions, dtype=int)
    inamberRight = np.empty(numberofjunctions, dtype=int)

    # Reuse already-calculated optimal phase values
    outphase = outphase_optimal
    inphase = inphase_optimal
    outRed = outRed_optimal
    inRed = inRed_optimal
    outAmber = outAmber_optimal
    inAmber = inAmber_optimal

    # Extract additional timing values (right turn phases)
    for i in range(numberofjunctions):
        # Find positions of right turn phases
        outRight_pos = np.where(phaseID[i] == ringBarrier[inbound[i]])
        inRight_pos = np.where(phaseID[i] == ringBarrier[outbound[i]])

        outRight[i] = phasenew[i][outRight_pos[0][0]][outRight_pos[1][0]]
        inRight[i] = phasenew[i][inRight_pos[0][0]][inRight_pos[1][0]]
        outredRight[i] = phaseRednew[i][outRight_pos[0][0]][outRight_pos[1][0]]
        inredRight[i] = phaseRednew[i][inRight_pos[0][0]][inRight_pos[1][0]]
        outamberRight[i] = phaseAmbernew[i][outRight_pos[0][0]][outRight_pos[1][0]]
        inamberRight[i] = phaseAmbernew[i][inRight_pos[0][0]][inRight_pos[1][0]]

    phaseID_new, phasenewer, phaseRednewer, phaseAmbernewer = _rearrange_phases(
        phaseID, phasenew, phaseRednew, phaseAmbernew,
        outbound, inbound, numberofjunctions, delta_new, flag,
        ringBarrier, outphase, inphase, outRed, inRed, outAmber, inAmber
    )
    # Barrier-balance each junction so both rings sum to the new cycle length.
    cnew_1, cnew_3 = _balance_cycle_lengths(
        phasenewer, phaseID_new, outbound, inbound, ringBarrier, numberofjunctions, cycle)

    # ─── STEP: recompute red ratios, phi, and offsets from the balanced phases ───
    # (Interwoven with the rescale step above — kept inline for the same reason.)
    # Recalculate r values from FINAL rearranged phases (phasenewer).
    # Extract optimized phase timing values for coordinated phases from phasenewer
    outphase_final = np.empty(numberofjunctions, dtype=int)
    inphase_final = np.empty(numberofjunctions, dtype=int)
    outRed_final = np.empty(numberofjunctions, dtype=int)
    inRed_final = np.empty(numberofjunctions, dtype=int)
    outAmber_final = np.empty(numberofjunctions, dtype=int)
    inAmber_final = np.empty(numberofjunctions, dtype=int)

    for i in range(numberofjunctions):
        # Find positions using phaseID_new (rearranged phase IDs)
        out_r, out_s = _match_pos(phaseID_new, outbound[i], i)
        in_r, in_s = _match_pos(phaseID_new, inbound[i], i)
        outphase_final[i] = phasenewer[i][out_r][out_s]
        inphase_final[i] = phasenewer[i][in_r][in_s]
        outRed_final[i] = phaseRednewer[i][out_r][out_s]
        inRed_final[i] = phaseRednewer[i][in_r][in_s]
        outAmber_final[i] = phaseAmbernewer[i][out_r][out_s]
        inAmber_final[i] = phaseAmbernewer[i][in_r][in_s]

    # Recalculate r values based on FINAL rearranged phase values
    # CHANGE 4: phase input already represents green time only
    # No subtraction needed - outphase_final/inphase_final are already green-only
    # r = (cycle - green - red_clearance) / cycle
    outGreen_final = outphase_final
    inGreen_final = inphase_final

    r_new = np.empty([2, numberofjunctions], dtype=float)
    # CHANGE 5: r must exclude both green AND red clearance portions
    # r = (cycle - green - red_clearance) / cycle
    r_new[0] = (cycle - outGreen_final) / cycle
    r_new[1] = (cycle - inGreen_final) / cycle

    # Update r to use the recalculated values
    r = r_new

    # Calculate phi using recalculated r values
    for i in range(numberofjunctions-1):
      # Outbound phi formula: phi[0,i] = 0.5*r[0,i] + w[0,i] + t[0,i] - 0.5*r[0,i+1] - w[0,i+1] - tao[0,i+1]
      # Represents relative time offset between junctions i and i+1 accounting for red times, timing adjustments, travel time, and queue clearance
      phi[0, i] = 0.5*r[0, i] + value(w[0][i]) + value(t[0][i]) - 0.5*r[0, i+1] - value(w[0][i+1]) - tao[0,i+1]
      # Inbound phi formula: phi[1,i] = 0.5*r[1,i] + w[1,i] + t[1,i] - 0.5*r[1,i+1] - w[1,i+1] - tao[1,i]
      # Note: inbound tao index is [1,i] not [1,i+1]
      phi[1, i] = 0.5*r[1, i] + value(w[1][i]) + value(t[1][i]) - 0.5*r[1, i+1] - value(w[1][i+1]) - tao[1, i]

    # Calculate offsets using recalculated phi and r values
    for i in range(numberofjunctions-1):
        if i == 0:
            offset[i] = (phi[0, i] - 0.5 * (1- r[0, i+1]) + 0.5 * (1-r[0, i]))*cycle
        else:
            offset[i] = (phi[0, i] - 0.5 * (1 - r[0, i+1]) + 0.5 * (1-r[0, i]))*cycle + offset[i - 1]

    # Calculate the actual (final) green-band bandwidth from the time-space
    # diagram geometry. Pure post-processing, no solver dependency — lives in
    # actual_bandwidth.compute_actual_bandwidth so this file stays MILP-only.
    bandwidth_outbound_actual, bandwidth_inbound_actual = compute_actual_bandwidth(
        numberofjunctions, cycle, time, r, phi,
        delta_new, cnew_1, cnew_3, outRed_final, inRed_final
    )

    # ─── STEP: assemble the output dict consumed by milp_to_gui ───
    output = {}
    output["Outbound_bandwidth_b"] = (b_var[0].value())
    output["Inbound_bandwidth_b_bar"] = (b_var[1].value())
    output["Outbound_bandwidth_actual"] = round(bandwidth_outbound_actual)
    output["Inbound_bandwidth_actual"] = round(bandwidth_inbound_actual)

    # Calculate attainability: ratio of bandwidth to smallest effective phase
    # minPhase = minimum of (phase - red) across all junctions
    minPhase = np.empty(2, dtype=float)
    minPhase[0] = np.min(outphase_final - outRed_final)  # Outbound
    minPhase[1] = np.min(inphase_final - inRed_final)    # Inbound

    # attainability = bandwidth / minPhase
    attainability = np.empty(2, dtype=float)
    attainability[0] = bandwidth_outbound_actual / minPhase[0] if minPhase[0] > 0 else 0
    attainability[1] = bandwidth_inbound_actual / minPhase[1] if minPhase[1] > 0 else 0

    output["Outbound_attainability"] = round(attainability[0], 2)
    output["Inbound_attainability"] = round(attainability[1], 2)

    output["NewCycle"] = round(cycle)

    for i in range(numberofjunctions-1):
      output["Time_Outbound" + str(i+1) + "-" + str(i+2)] = 0 if suppress_outbound else round(time[0, i])
      output["Time_Inbound" + str(i+1) + "-" + str(i+2)] = 0 if suppress_inbound  else round(time[1, i])
      output["Speed_Outbound" + str(i+1) + "-" + str(i+2)] = 0 if suppress_outbound else round(speed[0, i])
      output["Speed_Inbound" + str(i+1) + "-" + str(i+2)] = 0 if suppress_inbound  else round(speed[1, i])
      output["Outbound_phi_" + str(i+1) + "-" + str(i+2)] = round(phi[0, i] * cycle)
      output["Inbound_phi_" + str(i+1) + "-" + str(i+2)] = round(phi[1, i] * cycle)
      
    # Post-process offsets to reference cycle start instead of outbound phase
    output["offset_0"] = 0
    
    # Track time to outbound phase for each junction (from its cycle start)
    time_to_outbound_per_junction = [0] * numberofjunctions
    
    for junction_idx in range(numberofjunctions):
        outbound_phase_id = outbound[junction_idx]
        
        # Find which ring and position the outbound phase is in after optimization
        outbound_ring = -1
        outbound_position = -1
        
        for ring in range(2):
            for pos in range(4):
                if phaseID_new[junction_idx][ring][pos] == outbound_phase_id:
                    outbound_ring = ring
                    outbound_position = pos
                    break
            if outbound_ring != -1:
                break
        
        # Calculate time from cycle start to outbound phase start for this junction
        if outbound_ring != -1 and outbound_position != -1:
            for pos in range(outbound_position):
                time_to_outbound_per_junction[junction_idx] += phasenewer[junction_idx][outbound_ring][pos]
    
    # Convert offsets from outbound reference to cycle reference
    # Use Junction 1's time to outbound as base adjustment to ensure all junctions reference Junction 1's cycle start
    base_adjustment = time_to_outbound_per_junction[0]
    for i in range(numberofjunctions-1):
        original_offset = round(offset[i]) % cycle
        # Add base adjustment and subtract current junction's time to outbound phase
        adjusted_offset = (original_offset + base_adjustment - time_to_outbound_per_junction[i+1]) % cycle
        output["offset_" + str(i+1)] = adjusted_offset

    output["Phase"] = phasenewer.tolist()
    output["PhaseRed"]= phaseRednewer.tolist()
    output["PhaseAmber"]= phaseAmbernewer.tolist()
    output["Phase_ID"] = phaseID_new.tolist()

    for i in range (numberofjunctions):
      if delta_new[0, i] == 0 and delta_new[1, i] == 1:
          output["new junction " + str(i+1) + " is  pattern"] = 1
      elif delta_new[0, i] == 1 and delta_new[1, i] == 0:
         output["new junction " + str(i+1) + " is  pattern"] = 2
      elif delta_new[0, i] == 0 and delta_new[1, i] == 0:
         output["new junction " + str(i+1) + " is  pattern"] = 3
      elif delta_new[0, i] == 1 and delta_new[1, i] == 0:
         output["new junction " + str(i+1) + " is  pattern"] = 4

    return output

def callback(phase, phaseID, phaseRed, phaseAmber, outbound, inbound, queue_time, k, speedRange, speedChangeRange, distance, cycleRange, flag):
    phase = np.array(phase)
    phaseID = np.array(phaseID)
    phaseRed = np.array(phaseRed)
    phaseAmber = np.array(phaseAmber)
    outbound = np.array(outbound)
    inbound = np.array(inbound)
    queue_time = np.array(queue_time, dtype= float)
    speedRange = np.array(speedRange)
    speedChangeRange = np.array(speedChangeRange, dtype=float)
    distance = np.array(distance)
    cycleRange = np.array(cycleRange)

    junctions = len(phase)
    #get cycle length for each junction
    cycle_lengths = []
    for phase_set in phase:
      cycle_length_1 = 0
      cycle_length_2 = 0
      for i in range(len(phase_set[0])):
        cycle_length_1 += phase_set[0][i]
        cycle_length_2 += phase_set[1][i]
      cycle_length = max(cycle_length_1, cycle_length_2)
      cycle_lengths.append(cycle_length)
 
    #get all the green time, red time, and right turn time
    # CHANGE 1: phase input now represents green time only (not total phase)
    # No subtraction needed - phase IS the green portion
    phaseGreen = phase
    outGreen = np.empty(junctions, dtype = int)
    inGreen = np.empty(junctions, dtype = int)

    for i in range (junctions):
      out_r, out_s = _match_pos(phaseID, outbound[i], i)
      in_r, in_s = _match_pos(phaseID, inbound[i], i)
      outGreen[i] = phaseGreen[i][out_r][out_s]
      inGreen[i] = phaseGreen[i][in_r][in_s]

    # ── One-way detection ───────────────────────────────────────────────────────
    # If every junction has zero green time for a direction, treat as one-way mode.
    # This is auto-detected from the phase input — no extra flag needed in the JSON.
    suppress_outbound = bool(np.all(outGreen == 0))
    suppress_inbound  = bool(np.all(inGreen == 0))
    if suppress_outbound and suppress_inbound:
        raise ValueError("Both outbound and inbound green times are zero — cannot optimise an empty corridor.")
    if suppress_outbound:
        logger.info("[ONE-WAY MODE] All outbound green times are 0 — running inbound-only optimisation.")
    if suppress_inbound:
        logger.info("[ONE-WAY MODE] All inbound green times are 0 — running outbound-only optimisation.")
    # ────────────────────────────────────────────────────────────────────────────

    ringBarrier = dict([(1, 2), (2, 1), (3, 4), (4, 3), (5, 6), (6, 5), (7, 8), (8, 7)])
    outRight = np.empty(junctions, dtype = int)
    inRight = np.empty(junctions, dtype = int)
    outRightnew = np.empty(junctions, dtype = int)
    inRightnew = np.empty(junctions, dtype = int)

    for i in range (junctions):
      outRight_r, outRight_s = _match_pos(phaseID, ringBarrier[inbound[i]], i)
      inRight_r, inRight_s = _match_pos(phaseID, ringBarrier[outbound[i]], i)
      outRight[i] = phase[i][outRight_r][outRight_s]
      inRight[i] = phase[i][inRight_r][inRight_s]
      outRightnew[i] = outRight[i]
      inRightnew[i] = inRight[i]

    red_time = np.empty([2, junctions], dtype = float)

    for i in range (junctions):
      # Calculate red time as: cycle - green
      red_time[0][i] = cycle_lengths[i] - outGreen[i]
      red_time[1][i] = cycle_lengths[i] - inGreen[i]

    #identify the pattern
    def determine_lead_lag(outbound, inbound, phaseID):
        lead_lag_status = []

        for i in range(len(outbound)):
        # Get the last dimension of the phase IDs for outbound and inbound
            outbound_last_dim = np.where(phaseID[i] == outbound[i])[-1]
            inbound_last_dim = np.where(phaseID[i] == inbound[i])[-1]

            # Compare the last dimension indices
            if outbound_last_dim < inbound_last_dim:
                status = "leading" #pattern 1
            elif outbound_last_dim > inbound_last_dim:
                status = "lagging" #pattern 2
            elif outbound_last_dim == inbound_last_dim == 0 or outbound_last_dim == inbound_last_dim == 2:
                status = "lag-lag" #pattern 4
            else:
                status = "lead-lead" #pattern 3

            lead_lag_status.append(status)

        return lead_lag_status

    lead_lag_status = determine_lead_lag(outbound, inbound, phaseID)
    rightturntime=np.array([outRightnew,inRightnew], dtype=float)
    
    #minus the input queue_time by 6, if 0 or less than 6, the queue_time will remain zero
    queue_time = np.maximum(queue_time - 6, 0)

    #divide the time with cycle length
    for i in range (junctions):
      red_time[0][i] = red_time[0][i] / cycle_lengths[i]
      red_time[1][i] = red_time[1][i] / cycle_lengths[i]  
      queue_time[0][i] = queue_time[0][i] / cycle_lengths[i]
      queue_time[1][i] = queue_time[1][i] / cycle_lengths[i]
      rightturntime[0][i] = rightturntime[0][i] / cycle_lengths[i]
      rightturntime[1][i] = rightturntime[1][i] / cycle_lengths[i]

    r = red_time 
    tao = queue_time
    rightturntime = rightturntime
    phase = np.array([phase_set / cycle_length for phase_set, cycle_length in zip(phase, cycle_lengths)])
    phaseRed = np.array(phaseRed)  # Keep as absolute values, don't normalize
    phaseAmber = np.array(phaseAmber)  # Keep as absolute values, don't normalize
    speedRange = speedRange / 3.6

    #calculate the reciprocal speed change range
    for i in range (junctions-2):
        numerator = 1.0 / speedChangeRange[0, i, 0]
        denominator = 1.0 / speedChangeRange[0, i, 1]
        a = abs(1.0 / (numerator - denominator))
        speedChangeRange[0, i, 0] = -a
        speedChangeRange[0, i, 1] = a
        numerator = 1.0 / speedChangeRange[1, i, 0]
        denominator = 1.0 / speedChangeRange[1, i, 1]
        b = abs(1.0 / (numerator - denominator))
        speedChangeRange[1, i, 0] = -b
        speedChangeRange[1, i, 1] = b      

    speedChangeRange = speedChangeRange / 3.6
    
    output = milp2(junctions, cycleRange, k, r, rightturntime, distance, speedRange, speedChangeRange, tao, lead_lag_status, phase, phaseRed, phaseAmber, flag, phaseID, outbound, inbound, cycle_lengths,
                   suppress_outbound=suppress_outbound, suppress_inbound=suppress_inbound)
    return output
