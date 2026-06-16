# Time-Space UI

Traffic signal optimization tool for coordinated arterial corridors. Users define
junction phase data; the system finds optimal cycle lengths and offsets to maximize
green-band bandwidth through the corridor.

See [`CONTEXT.md`](CONTEXT.md) for the full domain glossary (Corridor, Junction, Phase,
Cycle, Offset, Bandwidth, NEMA, etc.).

## Architecture

Two-server stack communicating over HTTP:

| Server   | Tech                              | Port | Entry point             |
|----------|-----------------------------------|------|-------------------------|
| Frontend | React 19 + TypeScript + Vite      | 5173 | `time-space-ui/src/main.tsx` |
| Backend  | Flask 3.0 (Python)                | 5000 | `APIs/frontendAPI.py`   |

The optimization engine lives in `milp-code/` and is called directly by the backend
(it is not a separate server). The frontend proxies `/optimize` requests to
`localhost:5000` via the Vite config.

## Prerequisites

- **Node.js** v18+ — https://nodejs.org
- **Python** 3.10+ (3.12 recommended) — https://www.python.org/downloads
  (check "Add Python to PATH" during install)
- A **Gurobi** license for the MILP solver (local `.lic` file or Gurobi Cloud/WLS
  credentials). See the Gurobi section in `.env`.
- **MongoDB** is *optional* — the optimizer runs fine without it; it is only used to
  store timing-plan history.

## First-time setup (Windows)

```powershell
# From the project root:
.\install.ps1          # or double-click install.bat
```

This script:
1. Checks for Node.js and Python.
2. Installs Python dependencies (`pip install -r requirements.txt`).
3. Installs frontend dependencies (`npm install` in `time-space-ui/`).
4. Creates `.env` from `.env.example` if it does not already exist.
5. Generates launcher scripts: `start-backend`, `start-frontend`, `start-all`
   (both `.ps1` and `.bat` variants).

> The `start-*` launchers do **not** ship with the project — they are created by
> `install.ps1`. Run the installer first.

### Configure `.env`

Open `.env` and fill in the required values before running:

| Variable             | Required | Notes |
|----------------------|----------|-------|
| `JWT_SECRET`         | Yes      | Long random string. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `AUTH_USERNAME`      | Yes      | Login username (e.g. an email). |
| `AUTH_PASSWORD_HASH` | Yes      | Generate: `python APIs/hash_password.py 'your-password'` |
| `ALLOWED_ORIGINS`    | Prod     | Frontend URL(s), comma-separated. Never `*` in production. |
| `MONGO_URI`          | Optional | Only needed for timing-plan history. |
| Gurobi license vars  | Yes      | `GRB_LICENSE_FILE` or the `GRB_WLS*` credentials. |

Security defaults are safe out of the box (`FLASK_DEBUG=False`, localhost binding).
**Never set `FLASK_DEBUG=True` in production** — it allows remote code execution.

## Running the app

```powershell
# Both servers, each in its own window (created by install.ps1):
.\start-all.bat

# Or individually:
python APIs/frontendAPI.py        # backend  -> http://localhost:5000
cd time-space-ui; npm run dev     # frontend -> http://localhost:5173
```

Then open **http://localhost:5173** in your browser.

## Key files

| File | Role |
|------|------|
| `APIs/frontendAPI.py`     | Flask server; owns the `/optimize` route and security headers |
| `APIs/api_translator.py`  | GUI ↔ MILP format translation — the core complexity of the system |
| `APIs/db.py`              | Optional MongoDB layer for timing-plan history |
| `milp-code/milp2FINAL.py` | Primary MILP solver: variable cycle length + bandwidth optimization |
| `milp-code/milp1FINAL.py` | Secondary solver: fixed cycle length |
| `time-space-ui/src/AppV2.tsx` | Root React component; owns state, phase matrix, diagram |
| `time-space-ui/src/types.ts`  | Shared TypeScript types |

## Optimization pipeline

```
AppV2.tsx
  -> POST /optimize (GUI JSON)
  -> api_translator.gui_to_milp()
  -> milp2FINAL.callback()   [PuLP + HiGHS / Gurobi solver]
  -> api_translator.milp_to_gui()
  -> AppV2.tsx (renders updated diagram + metrics)
```

The GUI uses a flexible 4–6 phase format with optional overlaps; the MILP solver
requires a strict NEMA 8-phase ring-barrier structure. The bidirectional translation
in `api_translator.py` is where most bugs live. For a deep explanation see
[`docs/references/NEMA_EXPLAINED.md`](docs/references/NEMA_EXPLAINED.md).

## Tests

```powershell
# Backend (pytest)
python -m pytest APIs/tests milp-code/tests

# Frontend (vitest)
cd time-space-ui; npm test

# Type-check the frontend
cd time-space-ui; npm run typecheck
```

The `/optimize` round-trip (`gui_to_milp -> solver -> milp_to_gui`) is the most
valuable integration surface.

## Further documentation

- [`CONTEXT.md`](CONTEXT.md) — domain glossary
- [`docs/SECURITY.md`](docs/SECURITY.md) — security model and deployment guidance
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/references/NEMA_EXPLAINED.md`](docs/references/NEMA_EXPLAINED.md) — NEMA ring-barrier structure
