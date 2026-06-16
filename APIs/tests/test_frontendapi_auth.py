"""
Tests for authentication + authorization wiring in frontendAPI.py.

Verifies the /api/auth/* routes and that protected endpoints reject requests
without a valid bearer token. Behaviour is exercised through the Flask test
client (the public HTTP interface).
"""

import os

import pytest

# Configure the auth env BEFORE importing the app so routes can authenticate.
os.environ["JWT_SECRET"] = "test-secret-key"
os.environ.setdefault("FLASK_ENV", "development")

import auth  # noqa: E402

os.environ["AUTH_USERNAME"] = "tester@example.com"
os.environ["AUTH_PASSWORD_HASH"] = auth.hash_password("s3cret-pass")

import frontendAPI  # noqa: E402


@pytest.fixture
def client():
    frontendAPI.app.config["TESTING"] = True
    # Disable rate limiting here so repeated login calls don't trip the limiter;
    # rate limiting has its own dedicated test module.
    frontendAPI.app.config["RATELIMIT_ENABLED"] = False
    frontendAPI.limiter.reset()
    return frontendAPI.app.test_client()


def _login(client, password="s3cret-pass"):
    return client.post(
        "/api/auth/login",
        json={"username": "tester@example.com", "password": password},
    )


def test_login_with_correct_credentials_returns_token(client):
    resp = _login(client)
    assert resp.status_code == 200
    body = resp.get_json()
    assert "token" in body and body["token"]


def test_login_with_wrong_password_is_rejected(client):
    resp = _login(client, password="wrong")
    assert resp.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_user_with_valid_token(client):
    token = _login(client).get_json()["token"]
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.get_json()["user"] == "tester@example.com"


def test_optimize_requires_auth(client):
    resp = client.post("/optimize", json={"junctions": []})
    assert resp.status_code == 401


def test_db_route_requires_auth(client):
    assert client.get("/api/clients").status_code == 401


def test_health_is_public(client):
    assert client.get("/health").status_code == 200
