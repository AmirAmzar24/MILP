# Ring-direction swap: GUI outbound → MILP Ring 1, GUI inbound → MILP Ring 0

The MILP solver (`milp2FINAL.py`) was built before the GUI, targeting an external visualization tool where Junction 1 was at the bottom and outbound traffic travelled bottom-to-top. That tool's convention hardwired outbound to Ring 1 ([6,5,8,7]) and inbound to Ring 0 ([1,2,3,4]) throughout the solver's constraints. When the GUI was later built, the company required the opposite display convention: Junction 1 at the top, outbound travelling top-to-bottom. Rather than modifying the solver — which would require re-verifying every optimization constraint — the swap is applied at the `map_inbound_outbound()` boundary in `api_translator.py`: GUI outbound is mapped to MILP Ring 1 and GUI inbound to MILP Ring 0. This is the correct place to absorb the mismatch. Do not "fix" it by changing the solver's ring convention.

## Considered options

- **Modify the MILP solver** to natively use top-to-bottom ordering — rejected because re-validating all constraints and signs in the optimization math is high-risk with no user-facing benefit.
- **Absorb the swap at the API boundary** (`map_inbound_outbound()`) — chosen because the mismatch is isolated to one function and the rest of the codebase remains unaffected.
