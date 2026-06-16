"""
Tests for the legacy milpAPI.py — it must not leak stack traces to clients
and must cap request size. (It remains unauthenticated and intended for
localhost-only/legacy use; these tests cover the information-disclosure fix.)
"""

import pytest

import milpAPI


@pytest.fixture
def client():
    milpAPI.app.config["TESTING"] = True
    return milpAPI.app.test_client()


def test_milp2_error_does_not_leak_traceback(client):
    resp = client.post("/milp2", json={"phase": "bad"})
    body = resp.get_json()
    assert "traceback" not in body
    assert "traceback" not in str(body).lower()


def test_milp1_error_does_not_leak_traceback(client):
    resp = client.post("/milp1", json={"phase": "bad"})
    body = resp.get_json()
    assert "traceback" not in body


def test_max_content_length_configured():
    assert milpAPI.app.config.get("MAX_CONTENT_LENGTH")
