# Engineer Handover

> Purpose: get the next engineer productive on Time-Space UI fast, and capture
> the knowledge that lives only in the outgoing engineer's head. This is the
> **entry point** — it links out to the focused docs rather than repeating them.
>
> Sections marked **FILL IN** need a human (the outgoing engineer) to complete
> them — they're the parts no one can reconstruct from the code.

---

## 0. Start here — the reading order

1. [`README.md`](../README.md) — what it is, prerequisites, install, run.
2. [`CONTEXT.md`](../CONTEXT.md) — the domain glossary. **Read this fully.**
   Traffic-signal terms are precise here; the code uses them literally.
3. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — how data flows, the module map,
   and the gotchas. The heart of the technical handover.
4. [`docs/references/NEMA_EXPLAINED.md`](references/NEMA_EXPLAINED.md) — the
   ring-barrier structure the solver requires.
5. [`docs/adr/`](adr/) — architecture decisions (start with
   [ADR-0001](adr/0001-ring-direction-swap.md), the ring-direction swap).
6. [`docs/SECURITY.md`](SECURITY.md) — security model + production checklist.

---

## 1. First day — a 30-minute walkthrough

Do this end-to-end before reading any solver code. The goal is to see the whole
loop work once.

1. **Install:** from the repo root, run `.\install.ps1` (or `install.bat`).
   It installs Python + frontend deps and creates `.env` and the `start-*`
   launchers. No solver license is needed (PuLP + HiGHS, open source).
2. **Run both servers:** `.\start-all.bat` (or run the two commands in
   `README.md` → "Running the app").
3. **Open** http://localhost:5173 and **log in** with `admin@example.com` /
   `admin` (the dev defaults).
4. **Load the demo:** open `time-space-ui/public/Demo_Project.json` from the UI
   (or use the folder panel). You should see a corridor with several junctions.
5. **Click Optimize.** Watch the green bands change and the comparison report
   appear (bandwidth + progression efficiency, before vs after).
6. **Now read the round trip:** open `docs/ARCHITECTURE.md` §3 and follow the
   `/optimize` flow with these files side by side:
   - `time-space-ui/src/hooks/useOptimization.ts` (builds the request)
   - `APIs/frontendAPI.py` → `optimize()` (the route)
   - `APIs/api_translator.py` → `gui_to_milp()` / `milp_to_gui()` (the hard part)
7. **Break something on purpose:** run the tests
   (`python -m pytest APIs/tests milp-code/tests`), tweak a translator line,
   watch a golden test fail, revert. This teaches you the safety net.

If you can do all 7, you understand the system's spine.

---

## 2. What this project is (one paragraph)

Time-Space UI optimizes coordinated traffic-signal timing along an arterial
corridor. A user enters each junction's phases; the tool finds the cycle length
and per-junction offsets that maximize the green "bandwidth" a platoon can ride
through the whole corridor without stopping. The frontend is a React phase
editor + time-space diagram; the backend is a Flask app that translates the
GUI's flexible phase format into the strict NEMA 8-phase format a MILP solver
requires, runs the solver, and translates the result back. See `CONTEXT.md` for
every term.

---

## 3. Tech stack & where it runs

| Layer | Tech | Entry point | Port |
|------|------|-------------|------|
| Frontend | React 19 + TypeScript + Vite | `time-space-ui/src/main.tsx` | 5173 |
| Backend | Flask 3 (Python 3.10+) | `APIs/frontendAPI.py` | 5000 |
| Solver | PuLP + HiGHS (in-process) | `milp-code/milp2FINAL.py` | — |
| DB (optional) | MongoDB | `APIs/db.py` | — |

**FILL IN — deployment reality:**
- Where (if anywhere) is this deployed today? (URL, host, cloud account, who has
  access.) If it's local-only right now, say that explicitly.
- Is there a CI/CD pipeline? Where do builds/tests run?
- Where does the MongoDB instance live (Atlas cluster?), and who owns the
  account? (Rotate the committed demo password — see `docs/SECURITY.md`.)

For deploying safely (HTTPS, reverse proxy, secrets, rate-limit storage), follow
the **Production checklist** and **Reverse proxy** sections in
[`docs/SECURITY.md`](SECURITY.md) — that runbook already exists; don't duplicate
it, extend it if you learn something new.

---

## 4. Known issues, limitations & roadmap

What's true today (from the code):

- **Disabled output rotation** (`api_translator.py:434`, `TODO(pending-decision)`)
  — a coupled change with `milp2FINAL.py`'s offset handling; see
  `ARCHITECTURE.md` §6.5.
- **Token revocation is client-side only** — tokens stay valid until expiry
  (8h). See `docs/SECURITY.md` → residual risks.
- **No hard solver timeout** — a heavy authenticated input can run long.
- **Dev-only npm advisories** on `vite` / plugin — build-time only, not shipped.

**FILL IN — the parts only you know:**
- Current known bugs (even small/cosmetic ones) and how to reproduce them.
- Half-finished work or branches in flight.
- "If I had another month I would…" — your intended next steps and why.
- Explicit **non-goals** — things that look missing but were deliberately left
  out, so the next person doesn't "fix" them.
- Any performance limits you've hit (corridor size, solve time).

---

## 5. Domain primer (for a software engineer new to traffic)

You don't need to be a traffic engineer, but you need a mental model:

- A **corridor** is a line of traffic lights (**junctions**) on one road.
- Each junction cycles through **phases** (who gets green). One cycle = a fixed
  number of seconds.
- If you start each junction's green at the right moment relative to its
  neighbour (its **offset**), a platoon of cars hits green after green —
  "green wave." The width of that continuous green window is the **bandwidth**,
  and maximizing it is the whole point.
- **NEMA** is the rigid industry phase format the solver speaks; the GUI uses a
  friendlier format and the translator converts between them.

Read `CONTEXT.md` for the exact definitions, then
`docs/references/NEMA_EXPLAINED.md` for the ring-barrier mechanics.

---

## 6. People, ownership & external dependencies

**FILL IN:**
- **Domain/requirements owner** — who decides what "correct" optimization means?
  (The traffic engineer / stakeholder who can answer "should it do X?")
- **Stakeholders / client** — there's a "Sascoos" logo
  (`time-space-ui/public/SascoosLogo.png`) and `db.py` references a `sascoos`
  collection. Document this relationship: who they are, what they expect, SLAs.
- **Accounts & secrets** — MongoDB Atlas, any hosting, domain/DNS, TLS certs.
  Who holds them; how the next engineer gets access. (Do **not** paste secrets
  here — point to the password manager / vault.)
- **Third-party services / licenses** — none required for the solver (PuLP +
  HiGHS are open source). List anything else you added.
- **Where the input data comes from** — are junction configs hand-authored,
  exported from a controller, or pulled from MongoDB? Document the real source.

---

## 7. Day-to-day commands

```powershell
# Run
.\start-all.bat                          # both servers
python APIs/frontendAPI.py               # backend only -> :5000
cd time-space-ui; npm run dev            # frontend only -> :5173

# Test
python -m pytest APIs/tests milp-code/tests   # backend
cd time-space-ui; npm test                     # frontend
cd time-space-ui; npm run typecheck            # TS types

# Inspect translation without solving (great for debugging)
#   POST /validate   -> returns the MILP input it would send
#   POST /preprocess -> shows cycle-standardization before/after
```

The `/validate` and `/preprocess` endpoints (in `frontendAPI.py`) are
underrated debugging tools — they let you see the translator's output without
running the solver.

---

## 8. Conventions to keep

- **Add an ADR** (`docs/adr/`) for any significant or surprising decision,
  following the ADR-0001 format. Future-you will thank present-you.
- **Update `CONTEXT.md`** whenever you introduce or rename a domain concept —
  the precise vocabulary is what keeps the code and docs aligned.
- **Treat golden tests as truth.** Regenerate them only on intentional,
  verified behavior changes (`ARCHITECTURE.md` §7).
- **Never commit real secrets.** `.env` is local; production secrets go in a
  vault (`docs/SECURITY.md`).

---

## 9. Handover completion checklist (for the outgoing engineer)

- [ ] All **FILL IN** sections in this doc and `ARCHITECTURE.md` §4/§6 completed.
- [ ] Deployment + accounts/secrets access transferred (§3, §6).
- [ ] MongoDB demo password rotated; new engineer has DB access.
- [ ] Dev credentials / `JWT_SECRET` story explained for production.
- [ ] A live walkthrough done with the next engineer (consider recording it).
- [ ] Open questions / in-flight work written down (§4).
- [ ] Next engineer has run the §1 walkthrough successfully on their own machine.
```
</content>
