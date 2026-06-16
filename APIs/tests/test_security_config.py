"""
Tests for security configuration: CORS default must not be wide-open (*).

When no ALLOWED_ORIGINS/CORS_ORIGINS env var is set (the test environment),
the API should restrict CORS to known dev origins rather than echoing '*'.
"""

import os

os.environ["JWT_SECRET"] = "test-secret-key"
os.environ.setdefault("FLASK_ENV", "development")

import pytest  # noqa: E402

import frontendAPI  # noqa: E402


@pytest.fixture
def client():
    frontendAPI.app.config["TESTING"] = True
    return frontendAPI.app.test_client()


def test_cors_does_not_allow_unknown_origin(client):
    resp = client.get("/health", headers={"Origin": "http://evil.example.com"})
    acao = resp.headers.get("Access-Control-Allow-Origin")
    assert acao != "*"
    assert acao != "http://evil.example.com"


def test_cors_allows_dev_origin(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


# ── Debug/host RCE guard ────────────────────────────────────────────────────

def test_default_host_is_localhost(monkeypatch):
    monkeypatch.delenv("FLASK_HOST", raising=False)
    host, _, _ = frontendAPI.resolve_run_config()
    assert host == "127.0.0.1"


def test_debug_forced_off_when_host_is_public(monkeypatch):
    monkeypatch.setenv("FLASK_HOST", "0.0.0.0")
    monkeypatch.setenv("FLASK_DEBUG", "True")
    host, _, debug = frontendAPI.resolve_run_config()
    assert host == "0.0.0.0"
    assert debug is False  # debugger must never be exposed on a network interface


def test_debug_allowed_on_localhost(monkeypatch):
    monkeypatch.setenv("FLASK_HOST", "127.0.0.1")
    monkeypatch.setenv("FLASK_DEBUG", "True")
    _, _, debug = frontendAPI.resolve_run_config()
    assert debug is True


# ── ProxyFix trust flag ─────────────────────────────────────────────────────

def test_should_trust_proxy_defaults_off(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert frontendAPI.should_trust_proxy() is False


def test_should_trust_proxy_enabled(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY", "true")
    assert frontendAPI.should_trust_proxy() is True
    monkeypatch.setenv("TRUST_PROXY", "false")
    assert frontendAPI.should_trust_proxy() is False
