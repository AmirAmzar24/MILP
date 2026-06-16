"""
Tests for rate limiting (flask-limiter) added during security hardening.

The login route must allow at most 5 attempts per 15 minutes, returning 429
afterwards. Storage is reset around each test so counts don't leak between
tests.
"""

import os

import pytest

os.environ["JWT_SECRET"] = "test-secret-key"
os.environ.setdefault("FLASK_ENV", "development")

import auth  # noqa: E402

os.environ["AUTH_USERNAME"] = "tester@example.com"
os.environ["AUTH_PASSWORD_HASH"] = auth.hash_password("s3cret-pass")

import frontendAPI  # noqa: E402


@pytest.fixture
def client():
    frontendAPI.app.config["TESTING"] = True
    frontendAPI.app.config["RATELIMIT_ENABLED"] = True
    frontendAPI.limiter.reset()
    yield frontendAPI.app.test_client()
    frontendAPI.limiter.reset()
    frontendAPI.app.config["RATELIMIT_ENABLED"] = False


def test_login_blocks_after_five_attempts(client):
    # First 5 attempts are allowed through to the auth check (401 for bad creds).
    for _ in range(5):
        resp = client.post(
            "/api/auth/login",
            json={"username": "x@x.com", "password": "wrong"},
        )
        assert resp.status_code == 401
    # The 6th within the window is rate limited.
    resp = client.post(
        "/api/auth/login",
        json={"username": "x@x.com", "password": "wrong"},
    )
    assert resp.status_code == 429
