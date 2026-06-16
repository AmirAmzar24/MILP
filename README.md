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

`install.ps1` creates `.env` from `.env.example` with **local-dev defaults that work
out of the box** — including a pre-configured login. You do not need to edit anything
to run the app locally. The only thing you must supply is a **Gurobi license**
(`GRB_LICENSE_FILE` or the `GRB_WLS*` credentials) for the solver.

| Variable             | Default (local)        | Notes |
|----------------------|------------------------|-------|
| `FLASK_ENV`          | `development`          | Set `production` when deploying. |
| `ALLOWED_ORIGINS`    | `http://localhost:5173`| Browser origins allowed to call the API. **Must include the frontend URL** or the GUI shows "cannot connect to server." |
| `JWT_SECRET`         | dev value provided     | Regenerate for production. |
| `AUTH_USERNAME`      | `admin@example.com`    | Default login user. |
| `AUTH_PASSWORD_HASH` | hash of `admin`        | Default password is `admin`. |
| `MONGO_URI`          | unset (disabled)       | Optional — only for timing-plan history. |
| Gurobi license vars  | **you must set**       | `GRB_LICENSE_FILE` or the `GRB_WLS*` credentials. |

**Default login:** username `admin@example.com`, password `admin`.

> ⚠️ The default login and `JWT_SECRET` are known, weak dev credentials. **Before
> sharing or deploying the app**, set `FLASK_ENV=production`, point `ALLOWED_ORIGINS`
> at the real frontend URL, and regenerate the secret and password:
> ```powershell
> python -c "import secrets; print(secrets.token_urlsafe(48))"   # -> JWT_SECRET
> python APIs/hash_password.py 'your-new-password'               # -> AUTH_PASSWORD_HASH
> ```
> Never set `FLASK_DEBUG=True` in production — it allows remote code execution.

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

## Troubleshooting

**GUI says "cannot connect to server" / "Could not reach the server" on login**
The frontend (`localhost:5173`) talks to the backend at `localhost:5000`. Check, in order:
1. **Is the backend running?** A separate window should show "Frontend API Server
   Starting..." on port 5000. Open http://localhost:5000/health — it should respond.
   If not, start it: `python APIs/frontendAPI.py`.
2. **CORS** — `ALLOWED_ORIGINS` in `.env` must include the exact frontend URL
   (`http://localhost:5173`). If it points anywhere else, the browser blocks the
   request and the GUI reports it as "cannot connect." Fix the value and restart the
   backend. (This was the most common first-run issue.)
3. **Windows Firewall** may prompt the first time Python opens a port — allow it.
4. After editing `.env`, **restart the backend** for changes to take effect.

**Login rejected ("Invalid credentials")**
Use the default `admin@example.com` / `admin`, or, if you changed them, make sure
`AUTH_PASSWORD_HASH` was produced by `python APIs/hash_password.py 'password'`
(plaintext passwords will never match).

**Solver errors / optimization fails**
Confirm a valid Gurobi license is configured in `.env` (`GRB_LICENSE_FILE` or the
`GRB_WLS*` credentials).

## Further documentation

- [`CONTEXT.md`](CONTEXT.md) — domain glossary
- [`docs/SECURITY.md`](docs/SECURITY.md) — security model and deployment guidance
- [`docs/adr/`](docs/adr/) — architecture decision records
- [`docs/references/NEMA_EXPLAINED.md`](docs/references/NEMA_EXPLAINED.md) — NEMA ring-barrier structure
