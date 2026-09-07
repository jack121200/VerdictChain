"""Verifies the sandbox boundary itself (SKILL-security.md Section 7 checklist:
"Self-healing actions verified sandboxed by writing an explicit test that
asserts no real network call is made"), not just the business logic.
"""

import socket
from unittest.mock import patch

from backend.self_healing import sandbox


def test_lock_account_makes_no_real_network_call():
    with patch.object(socket, "socket") as mock_socket:
        result = sandbox.lock_account("jdoe")
    mock_socket.assert_not_called()
    assert "jdoe" in result
    assert "simulated" in result


def test_block_ip_range_makes_no_real_network_call():
    with patch.object(socket, "socket") as mock_socket:
        result = sandbox.block_ip_range("10.0.0.0/24")
    mock_socket.assert_not_called()
    assert "10.0.0.0/24" in result


def test_trigger_rate_limiting_makes_no_real_network_call():
    with patch.object(socket, "socket") as mock_socket:
        result = sandbox.trigger_rate_limiting("10.0.0.5")
    mock_socket.assert_not_called()
    assert "10.0.0.5" in result


def test_trigger_audit_makes_no_real_network_call():
    with patch.object(socket, "socket") as mock_socket:
        result = sandbox.trigger_audit("investigation-123")
    mock_socket.assert_not_called()
    assert "investigation-123" in result


def test_lock_account_actually_records_state():
    sandbox._directory_service.locked_accounts.clear()
    sandbox.lock_account("test_user_abc")
    assert "test_user_abc" in sandbox._directory_service.locked_accounts


def test_module_has_no_networking_imports():
    """Structural check: this file must never import a networking library at
    all - the guarantee is "the code physically cannot", not "we chose not to".
    """
    import inspect

    source = inspect.getsource(sandbox)
    for forbidden in (
        "import socket",
        "import httpx",
        "import requests",
        "import subprocess",
        "import urllib",
    ):
        assert forbidden not in source, f"sandbox.py must never import {forbidden.split()[-1]}"
