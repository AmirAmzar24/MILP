"""
Authentication layer for the Frontend API.

Provides:
- Password hashing/verification via werkzeug (PBKDF2; ships with Flask).
- Signed, expiring bearer tokens via itsdangerous (ships with Flask).
- An env-backed user store (no MongoDB dependency, so auth works even when
  the optional database layer is absent).

Credentials are supplied via environment variables:
    JWT_SECRET           - secret used to sign tokens (required)
    AUTH_USERNAME        - single-user mode: the username (email)
    AUTH_PASSWORD_HASH   - single-user mode: PBKDF2 hash of the password
    AUTH_USERS           - multi-user mode: JSON {"user": "<hash>", ...}

Use APIs/hash_password.py to generate a password hash for the .env file.
"""

import json
import os

from itsdangerous import URLSafeTimedSerializer, BadData
from werkzeug.security import generate_password_hash, check_password_hash

# Tokens expire after this many seconds (8 hours).
TOKEN_TTL_SECONDS = 8 * 60 * 60

# Namespace for the signing salt — separates these tokens from any other
# itsdangerous use of the same secret.
_TOKEN_SALT = "frontend-api-auth"


def hash_password(password: str) -> str:
    """Return a PBKDF2 hash of the given plaintext password."""
    return generate_password_hash(password)


def _load_users() -> dict:
    """
    Load the username -> password-hash map from the environment.

    Multi-user mode (AUTH_USERS JSON) takes precedence; otherwise the single
    AUTH_USERNAME / AUTH_PASSWORD_HASH pair is used. Returns {} if neither is
    configured (which means authentication will reject everyone).
    """
    raw = os.environ.get("AUTH_USERS")
    if raw:
        try:
            users = json.loads(raw)
            if isinstance(users, dict):
                return users
        except (ValueError, TypeError):
            pass
    username = os.environ.get("AUTH_USERNAME")
    pw_hash = os.environ.get("AUTH_PASSWORD_HASH")
    if username and pw_hash:
        return {username: pw_hash}
    return {}


def authenticate(username: str, password: str) -> bool:
    """Return True if the username/password match the configured user store."""
    if not username or not password:
        return False
    users = _load_users()
    pw_hash = users.get(username)
    if not pw_hash:
        return False
    return check_password_hash(pw_hash, password)


def _get_serializer() -> URLSafeTimedSerializer:
    """Build a serializer from the current JWT_SECRET (read lazily)."""
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET environment variable is not set")
    return URLSafeTimedSerializer(secret, salt=_TOKEN_SALT)


def create_token(username: str) -> str:
    """Create a signed token carrying the username."""
    return _get_serializer().dumps({"sub": username})


def verify_token(token: str) -> str | None:
    """
    Return the username encoded in a valid, unexpired token, else None.

    Returns None for any tampered, malformed, or expired token rather than
    raising, so callers can treat all failures uniformly as 401.
    """
    if not token:
        return None
    try:
        data = _get_serializer().loads(token, max_age=TOKEN_TTL_SECONDS)
    except BadData:
        return None
    if not isinstance(data, dict):
        return None
    return data.get("sub")
