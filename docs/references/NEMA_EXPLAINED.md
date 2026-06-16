# NEMA Phase Standard — What It Is and How Our System Uses It

## What is NEMA?

NEMA (National Electrical Manufacturers Association) defines a standard for traffic signal controllers used across North America and widely referenced internationally. The NEMA TS-2 standard specifies an **8-phase, dual-ring, barrier-based** signal timing structure that most physical traffic controllers implement.

Understanding this standard is essential because our MILP optimizer speaks NEMA natively — the GUI must translate to and from it.

---

## The NEMA 8-Phase Ring-Barrier Structure

### Rings and Barriers

NEMA uses two **rings** (Ring 0 and Ring 1) running concurrently, divided into two **barriers**. Each ring has 4 phase slots, giving 8 total phase IDs.

```
          ┌─ Barrier 1 ─────────────┬─ Barrier 2 ─────────────┐
Ring 0:   │  Ph 1  │  Ph 2          │  Ph 3  │  Ph 4          │
Ring 1:   │  Ph 6  │  Ph 5          │  Ph 8  │  Ph 7          │
          └─────────────────────────┴─────────────────────────┘
           Pos 0     Pos 1            Pos 2     Pos 3
```

Key rules:
- Both rings **run in parallel** — phases at the same position in each ring run simultaneously.
- Both rings must **cross the barrier at the same time** — a barrier boundary cannot be passed until both rings finish their current barrier's phases.
- Phases within a barrier can have **different durations** in each ring (one ring can be at a shorter phase while the other finishes a longer one, but both must reach the barrier before advancing).

### Standard NEMA Phase IDs

| Position | Ring 0 ID | Ring 1 ID |
|----------|-----------|-----------|
| 0        | 1         | 6         |
| 1        | 2         | 5         |
| 2        | 3         | 8         |
| 3        | 4         | 7         |

This is encoded in the system as:
```python
STANDARD_PHASE_IDS = [[1, 2, 3, 4], [6, 5, 8, 7]]
```

### Odd/Even Phase ID Convention

Phase IDs carry semantic meaning in NEMA:

- **Odd IDs** (1, 3, 5, 7) = **right-turn** movements
- **Even IDs** (2, 4, 6, 8) = **through** movements

Assignment rules:
- Right-turn: the odd ID is one less than the **opposing direction's** through ID (e.g., Ph1 is right-turn; its opposing through movement is Ph2, and 1 = 2 − 1)
- Through: even IDs are assigned clockwise starting with the heaviest movement

This means each ring-position pair runs complementary movement types simultaneously — at position 0, Ring 0 carries Ph1 (right-turn) while Ring 1 carries Ph6 (through): different movement types, opposite ring rows.

---

## Our GUI Input Format

The GUI represents each junction simply, without needing to know about rings or barriers. A junction in the GUI JSON looks like:

```json
{
  "name": "PG1(A4)",
  "phaseNames": ["P1", "P2", "P3", "P4"],
  "phases_s":   [30,   30,   30,   30],
  "outboundIdx": [0],
  "inboundIdx":  [1],
  "position_m":  0,
  "offset_s":    0
}
```

| Field          | Meaning |
|----------------|---------|
| `phaseNames`   | Labels for each phase (P1–P4, A1–A6, etc.) |
| `phases_s`     | Green time in seconds for each phase |
| `outboundIdx`  | Which phase index(es) carry outbound corridor traffic |
| `inboundIdx`   | Which phase index(es) carry inbound corridor traffic |
| `position_m`   | Absolute position along the corridor in metres |
| `offset_s`     | Timing offset from master junction reference |

> **Combined phases:** Each GUI phase entry silently represents **both** ring IDs at the same NEMA position. For example, phase "P1" covers Ph1 (Ring 0, right-turn) and Ph6 (Ring 1, through) simultaneously — both rings receive the same `phases_s` duration. This keeps the UI simple by hiding the ring structure from the user. The consequence is that both rings always get identical durations per GUI phase, which is why OVL must be expressed as a separate explicit entry: it is the only way to encode the unequal ring durations that produce the within-barrier overlap window.

The GUI supports 3–6 phases per junction. **Overlap (OVL) phases** (5th or 6th phases) are phases that serve movements in both directions simultaneously and must be handled specially during translation.

---

## GUI → MILP Translation (`gui_to_milp`)

The translation pipeline in `APIs/api_translator.py` performs these steps:

### Step 0 — Cycle Standardisation

All junction cycle lengths (sum of `phases_s`) are averaged. Each junction's green times and queue times are scaled proportionally to the average cycle using largest-remainder integer rounding. This ensures the MILP receives equal-length cycles, which is a mathematical requirement of the optimisation.

### Step 1 — Phase Rearrangement for Coordination

In standard NEMA the designated coordination phases are **NEMA 2** (Ring 0, position 1) and **NEMA 6** (Ring 1, position 0) — the through movements that receive the green wave. After the ring-swap described later, outbound maps to Ring 1 and inbound maps to Ring 0, so the target NEMA IDs for coordination are:

- Outbound → NEMA 6 (Ring 1, position 0)
- Inbound → NEMA 2 (Ring 0, position 1)

The function `rearrange_phases_for_coordination()` rotates the GUI phase array so that the user-selected outbound and inbound phases land at **logical positions 0 and 1** of the array (putting them within Barrier 1, where the MILP expects the coordination pair).

Example:
```
GUI order:  ["A1", "A2", "A3", "A4"],  outbound=idx 1,  inbound=idx 2
After rotate: ["A2", "A3", "A4", "A1"]  (rotate left by 1)
```

Overlap (OVL) phases are excluded from the consecutiveness check so they don't interfere with the rotation logic.

### Step 2 — Build Dual-Ring Phase Array (`build_nema_structure`)

Each junction's single list of phase durations is expanded into a `[2][4]` array (two rings × four positions).

**Normal 4-phase junction:** Both rings get identical durations:
```
phases_s = [30, 40, 25, 35]
Ring 0:    [30, 40, 25, 35]
Ring 1:    [30, 40, 25, 35]
```

**OVL phase (5 or 6 phase junction):** The overlap duration is added to the adjacent position in **alternating rings** — Ring 0 gets it added to the position *after* the overlap; Ring 1 gets it added to the position *before*. This is because Ring 0 has already advanced past its shorter phase to the next position, while Ring 1 is still running its longer phase at the current position.

**Asymmetric (T-junction) junction:** When one barrier contains an exclusive phase (serving only one direction) and a bridge phase (serving both directions), the two rings handle it asymmetrically. **Ring 0 (inbound ring)** is collapsed to a single effective barrier duration — one position absorbs the full barrier total and the other is zeroed. For an outbound-exclusive barrier the bridge absorbs the total in Ring 0 (inbound cannot use the outbound-only phase); for an inbound-exclusive barrier the exclusive absorbs the total in Ring 0. **Ring 1 (outbound ring)** retains both split values unchanged. Barriers that have no outbound phases at all are entirely zeroed in Ring 1.

### Step 3 — Map Coordination Phases to NEMA IDs (`map_inbound_outbound`)

The GUI's `outboundIdx`/`inboundIdx` (zero-based array positions) are converted to actual NEMA phase IDs from the standard structure.

There is a coordinate-system swap here — the GUI uses top-to-bottom ordering while the MILP uses bottom-to-top. As a result:
- GUI **outbound** → **Ring 1** NEMA IDs (`[6, 5, 8, 7]`)
- GUI **inbound** → **Ring 0** NEMA IDs (`[1, 2, 3, 4]`)

### Step 4 — Build Remaining MILP Fields

| MILP field       | Source |
|------------------|--------|
| `phase`          | `[num_junctions][2][4]` green times from Step 2 |
| `phaseID`        | Standard `[[1,2,3,4],[6,5,8,7]]` for every junction |
| `phaseRed`       | `[num_junctions][2][4]` all-red clearance times |
| `phaseAmber`     | `[num_junctions][2][4]` amber clearance times |
| `outbound`       | NEMA ID per junction (from Step 3) |
| `inbound`        | NEMA ID per junction (from Step 3) |
| `queue_time`     | `[[outbound_queue_s], [inbound_queue_s]]` |
| `distance`       | `[[outbound_dists], [inbound_dists]]` in metres (symmetric) |
| `speedRange`     | `[2][segments][min,max]` in km/h |
| `speedChangeRange` | `[2][segments-1][min,max]` in km/h |
| `cycleRange`     | `[min_cycle, max_cycle]` in seconds |
| `k`              | Progression quality exponent |
| `flag`           | Optimisation mode flag |

---

## MILP → GUI Translation (`milp_to_gui`)

The reverse translation reconstructs the GUI format from MILP optimisation output:

1. **Offsets** — `offset_i` values from the MILP are written directly to each junction's `offset_s`. All offsets are then relativised to the master junction (master junction offset is set to 0).

2. **Travel times** — `Time_Outbound{i}-{i+1}` and `Time_Inbound{i}-{i+1}` keys are extracted and written to `travelOut_s` / `travelIn_s`.

3. **Phase durations** — The optimised dual-ring arrays are collapsed back to a single GUI array via `reconstruct_phases_with_overlaps()`. For OVL phases the overlap value is recovered from the difference between the two rings at adjacent positions.

4. **Phase names and indices** — The NEMA IDs in the optimised output are mapped back to the user's original phase names via the NEMA→position→name lookup built during forward translation.

---

## Phase Mapping Reference

### GUI Phase Name → NEMA IDs

| GUI Label | NEMA IDs (Ring 0, Ring 1) | Notes |
|-----------|---------------------------|-------|
| A1        | 1, 6                      | Position 0 |
| A2        | 2, 5                      | Position 1 in a standard 4-phase junction. When A2 is the Barrier 1 OVL (5-phase junction) it has no NEMA IDs of its own — its duration is absorbed into adjacent positions and A3 shifts into position 1, inheriting IDs 2, 5 |
| A3        | 3, 8                      | Position 2 |
| A4        | 4, 7                      | Position 3 |
| A5        | 4, 7                      | Position 3 in 5-phase (A2 is OVL; A3 shifts into A2's former slot at pos 1) |
| A6        | 4, 7                      | Position 3 in 6-phase (A2 and A5 are OVL; A3→pos 1, A4→pos 2, A6→pos 3) |

### NEMA ID → (Ring, Position)

| NEMA ID | Ring | Position |
|---------|------|----------|
| 1       | 0    | 0        |
| 2       | 0    | 1        |
| 3       | 0    | 2        |
| 4       | 0    | 3        |
| 6       | 1    | 0        |
| 5       | 1    | 1        |
| 8       | 1    | 2        |
| 7       | 1    | 3        |

---

## Special Phase Configurations

### Overlap (OVL) Phases

**Physical meaning**

An OVL phase represents the period **within a single barrier** where, because the two ring phases have unequal lengths, one ring's phase ends early and advances to the next position while the other ring is still running. During this window both phases are simultaneously active — the same movement type (e.g., through) for opposing corridor directions is green at the same time.

Crucially, the OVL phase does **not** cross the barrier boundary. It sits entirely within one barrier, between the two phase positions of that barrier. The barrier boundary cannot be crossed until both rings complete all their phases in the current barrier.

**Identification**

OVL phases are identified via the `ovlPhaseIndices` field on the junction object. For older data that predates this field, the fallback is the intersection of `inboundIdx` and `outboundIdx` — phases that appear in both lists serve both corridor directions simultaneously, which is the defining property of a concurrent overlap movement.

By naming convention:
- **5-phase junction**: OVL is at GUI index 1 (sits between the two Barrier 1 phases)
- **6-phase junction**: OVL phases are at GUI indices 1 and 4 (one per barrier)

**Dual-ring encoding**

The OVL phase is not assigned its own MILP position. Its duration is instead distributed to the adjacent non-OVL positions on either side of the OVL within the same barrier, with each ring attributing the overlap time to the *opposite* side:

| Ring | OVL duration is added to… | Rationale |
|------|--------------------------|-----------|
| Ring 0 | Position **after** the OVL (next position in same barrier) | Ring 0 advanced past its shorter phase; the OVL window is counted as part of its next phase |
| Ring 1 | Position **before** the OVL (current position in same barrier) | Ring 1 is still running its longer phase; the OVL window extends its current phase |

This gives the two rings different totals at the positions flanking the OVL, which encodes the overlap duration as a recoverable difference.

**Worked example**

Standard 5-phase junction (normal 4-position junction with one OVL added in Barrier 1):

```
GUI phases:  [A1=30s,  A2=10s (OVL),  A3=40s  |  A4=25s,  A5=35s]
              ├─────────── Barrier 1 ───────────┤├──── Barrier 2 ────┤
                   OVL sits within Barrier 1    ↑ actual barrier boundary

Non-OVL phases: [A1=30, A3=40, A4=25, A5=35] → MILP positions [0, 1, 2, 3]

Ring 0:  [30,  40+10=50,  25,  35]   OVL (10s) added to pos 1 (A3 — position after OVL)
Ring 1:  [30+10=40,  40,  25,  35]   OVL (10s) added to pos 0 (A1 — position before OVL)
```

On the return path (`milp_to_gui`) the OVL value is recovered as the absolute difference between the two rings at the adjacent positions.

**5-phase vs 6-phase summary**

- 5-phase: one OVL at index 1. Four MILP positions are filled (A1, A3, A4, A5 at positions 0–3).
- 6-phase: OVL at indices 1 and 4. Four MILP positions are filled (A1, A3, A4, A6 at positions 0–3); each OVL is distributed into its respective flanking pair.

---

### Asymmetric (T-Junction) Phases

**Physical meaning**

At a T-intersection one approach leg is absent, creating a barrier with an imbalanced number of served movements. In signal terms this produces a barrier where one phase serves **only one** corridor direction (the *exclusive* phase) while the adjacent phase in that barrier serves **both** directions simultaneously (the *bridge* phase).

Example: a right-turn phase that only outbound traffic uses (no corresponding inbound leg exists at that arm) is the exclusive outbound phase. The parallel through movement that both directions share is the bridge. The barrier contains both, but the two rings must represent them differently because inbound traffic cannot use the outbound-exclusive phase.

The missing leg also creates an inherent within-barrier OVL: because the T-junction has no right-turn on the opposing approach (Ring 1 at the adjacent position is absent), the outbound through movement (Ring 1, exclusive position) keeps running while Ring 0 advances to the next position. This is the same OVL phenomenon as in a standard junction, but structural rather than optional. The bridge phase exists precisely because outbound (Ring 1 continuation) is still green during the adjacent position's period — making that position serve **both** outbound (Ring 1 continuation) and inbound (Ring 0 through) simultaneously. Designating the bridge position as inbound-only would be wrong because outbound is genuinely green there; designating it as outbound-only would drop the inbound coordination. The bridge resolves this by placing it in both `outboundIdx` and `inboundIdx`. Assigning both corridor directions to the same position is intentionally avoided — that would imply inbound and outbound come from the same approach, which is physically meaningless.

**Detection**

`detect_asymmetric_barriers()` examines each barrier's two positions (b×2 and b×2+1). A barrier is asymmetric when:

| Pattern | Condition | Result |
|---------|-----------|--------|
| **asym_out** | One position is in `outboundIdx` only; the adjacent position is in both `outboundIdx` and `inboundIdx` | Outbound-exclusive barrier |
| **asym_in** | One position is in `inboundIdx` only; the adjacent position is in both `outboundIdx` and `inboundIdx` | Inbound-exclusive barrier |

OVL phases are excluded from this detection and handled separately.

**Dual-ring encoding**

Because Ring 1 carries outbound and Ring 0 carries inbound, the two rings handle an asymmetric barrier differently:

**Ring 1 (outbound ring):** retains the original split durations for both phases in the asymmetric barrier — the MILP sees the full outbound picture unchanged. Barriers that have *no* outbound phases at all are entirely zeroed in Ring 1.

**Ring 0 (inbound ring):** collapsed to a single effective duration for the barrier. The position that represents inbound's usable movement absorbs the full barrier total; the other position is zeroed:

| Case | Ring 0 position that absorbs the barrier total | Ring 0 position set to 0 |
|------|------------------------------------------------|--------------------------|
| **asym_out** (exclusive outbound) | Bridge phase | Outbound-exclusive phase |
| **asym_in** (exclusive inbound) | Inbound-exclusive phase | Bridge phase |

For `asym_out`: inbound traffic cannot use the outbound-only phase, so the bridge position covers the entire barrier in Ring 0.
For `asym_in`: the exclusive inbound phase absorbs the full barrier time in Ring 0, telling the MILP that the inbound coordination covers the complete barrier duration.

**Worked example — outbound-exclusive barrier**

```
GUI phases:    [A1=20s, A2=40s, A3=40s, A4=0s]
outboundIdx:   [0, 1]   ← A1 = outbound-only,  A2 = bridge (serves both)
inboundIdx:    [1]      ← A2 = bridge only

Barrier 0 → asym_out (merge_at=A1 idx 0, bridge=A2 idx 1)
Barrier total = 20 + 40 = 60s

Ring 0 (inbound):  [  0,  60,  40,   0 ]   A1→0, A2→60 (bridge absorbs full barrier)
Ring 1 (outbound): [ 20,  40,   0,   0 ]   Barrier 0 unchanged; barrier 1 zeroed (no outbound)
```

The MILP sees inbound as having a single 60s phase at position 1 for this barrier, while outbound has a 20s + 40s split — correctly modelling the absent inbound leg at the T-intersection.

---

## Why the Rings Are Swapped

The MILP processes corridors from bottom-to-top (increasing junction index = moving away from origin in the coordinate system used). The GUI displays them top-to-bottom. This means what the GUI calls "outbound" (travelling away from origin, downward on screen) is actually the *lower* direction in MILP coordinates, which maps to Ring 1.

```
GUI convention:    outbound = top → bottom
MILP convention:   outbound = bottom direction = Ring 1 [6, 5, 8, 7]

GUI convention:    inbound  = bottom → top
MILP convention:   inbound  = top direction    = Ring 0 [1, 2, 3, 4]
```

This swap is applied consistently in `map_inbound_outbound()` and reversed in `milp_to_gui()`.
