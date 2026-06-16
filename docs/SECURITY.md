# Security & Deployment Guide

This document covers the security controls in the app and how to deploy it
safely. The backend is `APIs/frontendAPI.py` (the supported entry point);
`APIs/milpAPI.py` is a legacy, unauthenticated endpoint that must stay on
localhost only.

## Controls in place

| Control | Where | Notes |
|---------|-------|-------|
| Authentication (bearer tokens) | `APIs/auth.py`, `require_auth` | Protects `/optimize`, `/preprocess`, `/validate`, `/optimize/milp1`, all `/api/*` |
| Rate limiting | `flask_limiter` in `frontendAPI.py` | 5/15min on login, 10/min on `/optimize`, global defaults |
| Input validation | `validate_optimize_input` | Rejects malformed/oversized payloads (≤50 junctions, phases 0–300s) |
| Request size cap | `MAX_CONTENT_LENGTH` = 10MB | Both APIs; returns 413 |
| Safe error responses | `error_response`, logging | No stack traces / infra details leak to clients |
| Debug RCE guard | `resolve_run_config()` | Debugger force-disabled on non-loopback hosts |
| CORS | restricted by default | Set `ALLOWED_ORIGINS` in prod; never `*` |
| Security headers | `add_security_headers` | `nosniff`, `X-Frame-Options: DENY`, HSTS (prod) |

## Production checklist

- [ ] `FLASK_DEBUG=False` (auto-disabled on non-loopback hosts anyway).
- [ ] Serve over **HTTPS** (see reverse proxy below). Login credentials and
      bearer tokens travel in the request — never expose plain HTTP off-host.
- [ ] Set `VITE_API_URL=https://api.your-domain.com` for the frontend build.
- [ ] Set `ALLOWED_ORIGINS` to your exact frontend origin(s).
- [ ] Set a strong, unique `JWT_SECRET` (`python -c "import secrets;print(secrets.token_urlsafe(48))"`).
- [ ] Replace the dev login (`admin@local`) — generate a hash with
      `python APIs/hash_password.py 'pw'` and set `AUTH_PASSWORD_HASH`, or use
      `AUTH_USERS` for multiple accounts.
- [ ] **Rotate the MongoDB password** in Atlas (the committed demo uses a weak one)
      and restrict the DB user to least privilege.
- [ ] For multi-process/scaled deploys, set `RATELIMIT_STORAGE_URI` to Redis so
      limits are shared across workers.
- [ ] Set `TRUST_PROXY=true` **only** when behind a reverse proxy (below).

## Reverse proxy with TLS (recommended)

Terminate TLS at a reverse proxy and forward to the Flask app bound to
loopback. This gives you HTTPS and the correct client IP for rate limiting.

Run the API on localhost only:

```
FLASK_HOST=127.0.0.1
FLASK_PORT=5000
TRUST_PROXY=true
```

Example Caddy config (`Caddyfile`) — automatic HTTPS:

```
api.your-domain.com {
    reverse_proxy 127.0.0.1:5000
}
```

Equivalent nginx:

```nginx
server {
    listen 443 ssl;
    server_name api.your-domain.com;
    ssl_certificate     /etc/ssl/your-domain.crt;
    ssl_certificate_key /etc/ssl/your-domain.key;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

With `TRUST_PROXY=true`, the app reads `X-Forwarded-For` (via Werkzeug
`ProxyFix`) so the per-IP rate limits apply to the real client, not the proxy.
**Do not** set `TRUST_PROXY=true` without a proxy in front — clients could then
spoof `X-Forwarded-For` and bypass the limits.

## Known residual risks (accepted / optional)

- **Token revocation:** logout is client-side; tokens stay valid until expiry
  (8h). Lower the TTL in `auth.py` or add a denylist if you need instant revoke.
- **Long solves:** an authenticated user can submit valid-but-heavy inputs.
  Bounded by input validation; add a solver timeout for a hard cap.
- **Dev-only npm advisories:** `vite`/`@vitejs/plugin-react` have advisories that
  require a breaking major bump; they are build-time only and not shipped.
