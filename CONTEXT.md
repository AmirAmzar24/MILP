# Time-Space UI

A tool for optimizing coordinated traffic signal timing along arterial corridors. It takes junction phase data as input and finds cycle lengths and offsets that maximize uninterrupted vehicle progression through the corridor.

## Language

### Corridor and network

**Corridor**:
A sequence of two or more signalized junctions along an arterial road that are managed as a coordinated group.
_Avoid_: Route, road, street, network

**Junction**:
A single signalized intersection within the corridor. Each junction has its own signal controller with an independent phase sequence.
_Avoid_: Intersection, node, signal, light

### Signal timing

**Phase**:
A timed interval during which specific movements receive a green signal. A junction typically has 4–6 phases per cycle.
_Avoid_: Stage, step, interval

**Cycle**:
The full sequence of phases at a junction before it repeats, measured in seconds.
_Avoid_: Period, rotation, loop

**Offset**:
The timing reference point for a junction's cycle, stored as `offset_s`. Has two uses: (1) pre-optimization — an absolute time in seconds marking when phase 0 starts within the cycle, set by the user or left at 0; (2) post-optimization — a relative time in seconds between this junction's reference phase start and the master junction's reference phase start (master junction offset = 0). Offsets define when green bands align across the corridor.
_Avoid_: Shift, delay, lag

**Coordination phase**:
The through-movement phase used as the timing reference across all junctions. After phase rearrangement, the outbound and inbound coordination phases are placed at Barrier 1 positions (NEMA 6 and NEMA 2 respectively).
_Avoid_: Reference phase, main phase, arterial phase

**Overlap phase** (OVL):
A phase that fills the window within a single barrier where the two rings have unequal durations — one ring's phase ends early and advances to the next position while the other is still running, leaving both simultaneously green. The OVL phase does not cross the barrier boundary; it sits entirely within one barrier. By naming convention: index 1 (A2) in a 5-phase junction; indices 1 and 4 (A2 and A5) in a 6-phase junction.
_Avoid_: Concurrent phase, permissive phase, A6 (A5 is the second OVL position, not A6)

**Bandwidth**:
The duration of uninterrupted green time available for a vehicle platoon to travel through the full corridor without stopping. The primary optimization objective.
_Avoid_: Green band, progression window, throughput

**Queue time**:
The time required to discharge queued vehicles at the start of a green phase. Subtracts from usable bandwidth at each junction.
_Avoid_: Discharge time, clearance time, start-up loss

**Travel time**:
The time for a vehicle platoon to travel between two consecutive junctions. Constrains the offset relationship between those junctions.
_Avoid_: Link travel time, inter-junction time

### Optimization

**MILP** (Mixed Integer Linear Programming):
The mathematical optimization method used to find optimal cycle lengths and offsets. Solved by the HiGHS solver via PuLP.
_Avoid_: Optimizer, solver algorithm, LP

**Master junction**:
The user-selected reference junction for the corridor. After optimization, all junction offsets are expressed relative to the master junction, which is assigned offset 0. Any junction in the corridor can be designated as master via the optimization settings panel.
_Avoid_: Reference junction, origin junction, anchor junction

**Progression efficiency**:
The fraction of vehicles departing the first junction during green that can pass through the entire corridor without stopping. Computed as bandwidth ÷ effective green time at the first junction, capped at 1.0. Shown in the comparison report alongside bandwidth.
_Avoid_: Green efficiency, signal efficiency, throughput ratio

**k-factor**:
A scalar (0–1) that weights outbound vs inbound bandwidth in the objective function. 0 = outbound only, 0.5 = equal, 1 = inbound only.
_Avoid_: Direction weight, bias factor

**Phase Rearrangement**:
A user-controlled toggle in the optimization settings. When on (`flag=1`), the solver is free to choose the lead/lag pattern (leading or lagging) per junction independently to maximize bandwidth. When off (`flag=0`), the solver is locked to the lead/lag pattern the user specified for each junction. Despite the UI label, this toggle does not control phase order rearrangement — that step runs unconditionally before the solver is called.
_Avoid_: Flag, optimization flag, phase flag

**Lead/lag pattern**:
The timing relationship between the outbound and inbound coordination phases at a junction within the cycle. Four patterns exist, controlled by two binary MILP variables (δ0, δ1):

| Pattern | δ0 | δ1 | Meaning |
|---------|----|----|---------|
| Leading | 0 | 1 | Outbound phase starts before inbound |
| Lagging | 1 | 0 | Inbound phase starts before outbound |
| Lead-lead | 0 | 0 | Both directions have their phase starting first |
| Lag-lag | 1 | 1 | Both directions have their phase starting last |

When `flag=0`, the pattern is fixed per junction. When `flag=1`, the solver is free to choose leading or lagging only (δ0 + δ1 = 1).
_Avoid_: Phase sequence, timing pattern, offset pattern

**Cycle standardization**:
A pre-processing step that scales all junction cycle lengths to their average before the MILP runs. The purpose is to minimise distortion to queue times: when the solver produces a new common cycle length, it scales phase times proportionally — and queue times move with them. By averaging cycle lengths upfront, the scaling factor applied during optimization is smaller, so user-specified queue times are affected less. Uses integer averaging with largest-remainder rounding to preserve exact integer sums.
_Avoid_: Cycle harmonization, cycle normalization

### NEMA structure

**NEMA**:
The National Electrical Manufacturers Association standard that defines the 8-phase ring-barrier structure used by traffic signal controllers. The MILP solver requires all junctions to be expressed in this format.
_Avoid_: Standard, controller format

**Ring**:
One of two parallel phase sequences in the NEMA structure. Ring 0 carries phase IDs [1, 2, 3, 4]; Ring 1 carries phase IDs [6, 5, 8, 7]. Both rings run simultaneously; each ring ends at a barrier independently. In this system Ring 0 is the inbound ring and Ring 1 is the outbound ring (see ADR-0001).
_Avoid_: Stream, sequence

**Barrier**:
A synchronization point in the NEMA structure that both rings must reach simultaneously before either can advance. Barriers divide the cycle into two halves.
_Avoid_: Sync point, divider

**Asymmetric junction**:
A junction (typically a T-intersection or one-way street) where one barrier contains an exclusive phase and a bridge phase, producing unequal ring representations. Requires special handling in the translation layer.
_Avoid_: T-junction, unbalanced junction, skewed junction

**Bridge phase**:
In an asymmetric barrier, the phase that appears in both `outboundIdx` and `inboundIdx` — it serves both corridor directions simultaneously and bridges the absent approach leg. Contrast with exclusive phase.
_Avoid_: Shared phase, common phase

**Exclusive phase**:
In an asymmetric barrier, the phase that appears in only one direction's index (`outboundIdx` or `inboundIdx`) — it serves a single corridor direction with no corresponding movement on the opposing approach. Called `merge_at` in the code's internal detection logic.
_Avoid_: merge_at, dominant phase, single-direction phase

### System components

**GUI format**:
The JSON structure used by the React frontend to represent phase data (4–6 phases per junction, flexible overlap positions). Human-authored and human-readable.
_Avoid_: Frontend format, UI format, input format

**MILP format**:
The strict 8-phase NEMA ring-barrier JSON structure required by the optimization solver. Machine-generated by the translation layer.
_Avoid_: Solver format, backend format

**Translation layer**:
The `api_translator.py` module that converts bidirectionally between GUI format and MILP format. It handles phase rearrangement, overlap detection, asymmetry detection, and NEMA structure building. It also applies the ring-direction swap: the MILP engine's outbound convention (Ring 1) is opposite to the GUI's display convention, so GUI outbound is mapped to MILP Ring 1 and GUI inbound to MILP Ring 0 at the `map_inbound_outbound()` boundary.
_Avoid_: Converter, adapter, transformer, bridge

**Time-space diagram**:
A 2D visualization with distance (junctions) on one axis and time on the other. Green bands show coordinated progression windows. The primary output visualization of the tool.
_Avoid_: Progression diagram, space-time chart
