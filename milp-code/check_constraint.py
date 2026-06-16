"""
check_constraint.py - Verifies the coordination constraint from MILP2 after solving.

Constraint checked for each segment i (0 to junctions-2):

  LHS: (w[1][i] + w[0][i]) - (w[1][i+1] + w[0][i+1])
       + (t[0][i] + t[1][i])
       + delta[0][i]*l[0,i]   - delta[1][i]*l[1,i]
       - delta[0][i+1]*l[0,i+1] + delta[1][i+1]*l[1,i+1]
       - m[i]

  RHS: (r[0,i+1] - r[0,i]) + (tao[0,i+1] + tao[1,i])

  LHS == RHS  (within numerical tolerance)

Usage - call from inside milp2() after maxband.solve():
    from check_constraint import check_coordination_constraint
    check_coordination_constraint(w, t, delta, m_var, r, tao, l, numberofjunctions)
"""

from pulp import value


def check_coordination_constraint(w, t, delta, m_var, r, tao, l,
                                   numberofjunctions, tolerance=1e-4):
    """
    Parameters
    ----------
    w        : 2D list of PuLP vars  [direction][junction]
    t        : 2D list of PuLP vars  [direction][segment]
    delta    : 2D list of PuLP vars  [direction][junction]
    m_var    : 1D list of PuLP vars  [segment]
    r        : numpy array (2, junctions)  red-time ratios
    tao      : numpy array (2, junctions)  queue clearance times
    l        : numpy array (2, junctions)  right-turn times
    numberofjunctions : int
    tolerance : float  acceptable absolute difference (default 1e-4)
    """

    print("\n" + "=" * 65)
    print("  COORDINATION CONSTRAINT CHECK")
    print("=" * 65)
    print(f"  Segments to check: {numberofjunctions - 1}")
    print(f"  Tolerance: {tolerance}")
    print("-" * 65)

    all_ok = True

    for i in range(numberofjunctions - 1):
        # --- extract LP solution values ---
        w0_i   = value(w[0][i])
        w1_i   = value(w[1][i])
        w0_i1  = value(w[0][i + 1])
        w1_i1  = value(w[1][i + 1])
        t0_i   = value(t[0][i])
        t1_i   = value(t[1][i])
        d0_i   = value(delta[0][i])
        d1_i   = value(delta[1][i])
        d0_i1  = value(delta[0][i + 1])
        d1_i1  = value(delta[1][i + 1])
        m_i    = value(m_var[i])

        # --- LHS ---
        lhs = (
            (w1_i  + w0_i)
          - (w1_i1 + w0_i1)
          + (t0_i  + t1_i)
          + d0_i  * l[0, i]
          - d1_i  * l[1, i]
          - d0_i1 * l[0, i + 1]
          + d1_i1 * l[1, i + 1]
          - m_i
        )

        # --- RHS ---
        rhs = (r[0, i + 1] - r[0, i]) + (tao[0, i + 1] + tao[1, i])

        diff      = lhs - rhs
        satisfied = abs(diff) <= tolerance

        status_str = "OK" if satisfied else "VIOLATION"
        print(f"  Segment {i+1}-{i+2}:  LHS = {lhs:+.8f}  |  RHS = {rhs:+.8f}"
              f"  |  diff = {diff:+.2e}  |  [{status_str}]")

        if not satisfied:
            all_ok = False
            print(f"    !! LHS breakdown:")
            print(f"       (w1[{i}]+w0[{i}])      = {w1_i + w0_i:+.8f}")
            print(f"       (w1[{i+1}]+w0[{i+1}])    = {w1_i1 + w0_i1:+.8f}")
            print(f"       (t0[{i}]+t1[{i}])       = {t0_i + t1_i:+.8f}")
            print(f"       delta0[{i}]*l[0,{i}]    = {d0_i * l[0, i]:+.8f}")
            print(f"       delta1[{i}]*l[1,{i}]    = {-d1_i * l[1, i]:+.8f}")
            print(f"       delta0[{i+1}]*l[0,{i+1}]  = {-d0_i1 * l[0, i+1]:+.8f}")
            print(f"       delta1[{i+1}]*l[1,{i+1}]  = {d1_i1 * l[1, i+1]:+.8f}")
            print(f"       -m[{i}]               = {-m_i:+.8f}")
            print(f"    !! RHS breakdown:")
            print(f"       r[0,{i+1}]-r[0,{i}]     = {r[0, i+1] - r[0, i]:+.8f}")
            print(f"       tao[0,{i+1}]+tao[1,{i}] = {tao[0, i+1] + tao[1, i]:+.8f}")

    print("-" * 65)
    if all_ok:
        print("  RESULT: ALL segments satisfy the coordination constraint.")
    else:
        print("  RESULT: ONE OR MORE segments VIOLATED the constraint.")
    print("=" * 65 + "\n")

    return all_ok
