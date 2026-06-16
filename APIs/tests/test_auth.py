"""
Tests for auth.py — the authentication layer added during security hardening.

Covers password hashing, the env-backed user store, and signed expiring
bearer tokens. These test behaviour through the public interface only.
"""

import pytest

import auth


@pytest.fixture(autouse=True)
def _auth_env(monkeypatch):
    """Provide a known JWT secret and a single test user for every test."""
    monkeypatch.setenv("JWT_SECRET", "test-secret-key")
    # 'correct horse' hashed below via auth.hash_password at collection time
    pw_hash = auth.hash_password("s3cret-pass")
    monkeypatch.setenv("AUTH_USERNAME", "tester@example.com")
    monkeypatch.setenv("AUTH_PASSWORD_HASH", pw_hash)
    # Clear any multi-user JSON store so the single-user vars are used
    monkeypatch.delenv("AUTH_USERS", raising=False)


def test_token_roundtrip_returns_username():
    """A token created for a user verifies back to that same username."""
    token = auth.create_token("tester@example.com")
    assert auth.verify_token(token) == "tester@example.com"


def test_authenticate_accepts_correct_credentials():
    assert auth.authenticate("tester@example.com", "s3cret-pass") is True


def test_authenticate_rejects_wrong_password():
    assert auth.authenticate("tester@example.com", "wrong") is False


def test_authenticate_rejects_unknown_user():
    assert auth.authenticate("nobody@example.com", "s3cret-pass") is False


def test_verify_token_rejects_tampered_token():
    token = auth.create_token("tester@example.com")
    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert auth.verify_token(tampered) is None


def test_verify_token_rejects_garbage_and_empty():
    assert auth.verify_token("not-a-real-token") is None
    assert auth.verify_token("") is None


def test_verify_token_rejects_expired_token(monkeypatch):
    token = auth.create_token("tester@example.com")
    # Force every token to be considered expired.
    monkeypatch.setattr(auth, "TOKEN_TTL_SECONDS", -1)
    assert auth.verify_token(token) is None


def test_authenticate_supports_multi_user_store(monkeypatch):
    hash_a = auth.hash_password("alpha-pass")
    hash_b = auth.hash_password("bravo-pass")
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD_HASH", raising=False)
    monkeypatch.setenv("AUTH_USERS", auth.json.dumps({"a@x.com": hash_a, "b@x.com": hash_b}))
    assert auth.authenticate("a@x.com", "alpha-pass") is True
    assert auth.authenticate("b@x.com", "bravo-pass") is True
    assert auth.authenticate("a@x.com", "bravo-pass") is False
