"""
Tests for input validation and safe error responses (security hardening).

Covers: oversized / malformed payloads are rejected with a 400 and a safe
message, and error responses never leak stack traces or raw exception text.
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
    frontendAPI.app.config["RATELIMIT_ENABLED"] = False
    frontendAPI.limiter.reset()
    c = frontendAPI.app.test_client()
    token = c.post(
        "/api/auth/login",
        json={"username": "tester@example.com", "password": "s3cret-pass"},
    ).get_json()["token"]
    c.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return c


_LEAK_MARKERS = [
    "traceback",
    'file "',
    "object has no attribute",
    "attributeerror",
    "keyerror",
    "typeerror",
    "nonetype",
    "line ",
]


def _no_leak(body: dict):
    """Assert an error body carries a message but no stack trace / raw detail."""
    assert "traceback" not in body
    text = str(body).lower()
    for marker in _LEAK_MARKERS:
        assert marker not in text, f"error response leaked internal detail: {marker!r}"


def test_optimize_rejects_too_many_junctions(client):
    payload = {"junctions": [{"id": i} for i in range(51)]}
    resp = client.post("/optimize", json=payload)
    assert resp.status_code == 400
    body = resp.get_json()
    assert "error" in body
    _no_leak(body)


def test_optimize_rejects_non_list_junctions(client):
    resp = client.post("/optimize", json={"junctions": "not-a-list"})
    assert resp.status_code == 400
    _no_leak(resp.get_json())


def test_milp1_rejects_malformed_input(client):
    resp = client.post("/optimize/milp1", json={"junctions": "nope"})
    assert resp.status_code == 400
    _no_leak(resp.get_json())


def test_validate_does_not_leak_exception_on_bad_payload(client):
    # Structurally a list of junctions but missing the fields translation needs.
    resp = client.post("/validate", json={"junctions": [{"id": "a"}, {"id": "b"}]})
    assert resp.status_code == 400
    _no_leak(resp.get_json())


def test_db_status_does_not_leak_connection_error(client, monkeypatch):
    import db

    def boom():
        raise Exception(
            "SSL handshake failed: secret-cluster-00.abcde.mongodb.net:27017"
        )

    monkeypatch.setattr(db, "get_db", boom)
    resp = client.get("/api/db/status")
    body = resp.get_json()
    assert body["connected"] is False
    text = str(body)
    assert "mongodb.net" not in text
    assert "secret-cluster" not in text
