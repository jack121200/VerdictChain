"""The manual override path's sandbox functions (plan section 3.5): forward and inverse actions, with no
network. socket is patched only around the sandbox calls, never around a TestClient request.
"""

import ast
import inspect
import socket
from unittest.mock import patch

from backend.api.routes import containment
from backend.self_healing import sandbox


def test_the_inverse_table_covers_exactly_the_reversible_actions():
    assert set(sandbox.INVERSE_ACTIONS) == {"lock_account", "block_ip_range", "trigger_rate_limiting"}
    assert set(sandbox.INVERSE_ACTIONS) <= set(sandbox.FORWARD_ACTIONS)
    assert "trigger_audit" in sandbox.FORWARD_ACTIONS
    assert "trigger_audit" not in sandbox.INVERSE_ACTIONS  # an audit event has no inverse


def test_forward_and_inverse_calls_make_no_socket_call():
    with (
        patch.object(socket, "socket") as mock_socket,
        patch.object(socket, "create_connection") as mock_connect,
        patch.object(socket, "getaddrinfo") as mock_resolve,
    ):
        for action in sandbox.FORWARD_ACTIONS.values():
            action("target-1")
        for inverse in sandbox.INVERSE_ACTIONS.values():
            inverse("target-1")
    mock_socket.assert_not_called()
    mock_connect.assert_not_called()
    mock_resolve.assert_not_called()


def test_each_inverse_undoes_its_forward_state():
    sandbox.lock_account("jdoe-override")
    assert "jdoe-override" in sandbox._directory_service.locked_accounts
    sandbox.unlock_account("jdoe-override")
    assert "jdoe-override" not in sandbox._directory_service.locked_accounts

    sandbox.block_ip_range("10.9.0.0/24")
    assert "10.9.0.0/24" in sandbox._firewall.blocked_ranges
    sandbox.unblock_ip_range("10.9.0.0/24")
    assert "10.9.0.0/24" not in sandbox._firewall.blocked_ranges

    sandbox.trigger_rate_limiting("10.9.0.7")
    assert "10.9.0.7" in sandbox._firewall.rate_limited_targets
    sandbox.disable_rate_limiting("10.9.0.7")
    assert "10.9.0.7" not in sandbox._firewall.rate_limited_targets


def test_releasing_a_target_that_was_never_contained_is_harmless():
    assert "never-locked" not in sandbox._directory_service.locked_accounts
    message = sandbox.unlock_account("never-locked")
    assert "simulated" in message
    assert "never-locked" not in sandbox._directory_service.locked_accounts


FORBIDDEN_IMPORTS = {"llm_clients", "httpx", "requests", "urllib", "socket", "subprocess", "http"}
FORBIDDEN_NAMES = {"GeminiClient", "GroqClient"}


def test_the_manual_path_imports_no_llm_or_network_module():
    """The containment route and the sandbox must not reach an LLM or the network, even by import. This
    reads the import statements and name references, so prose in a docstring does not count.
    """
    for module in (containment, sandbox):
        tree = ast.parse(inspect.getsource(module))
        imported: set[str] = set()
        referenced: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[-1])
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.Name):
                referenced.add(node.id)
        assert not (imported & FORBIDDEN_IMPORTS), f"{module.__name__} imports {imported & FORBIDDEN_IMPORTS}"
        assert not (
            referenced & FORBIDDEN_NAMES
        ), f"{module.__name__} references {referenced & FORBIDDEN_NAMES}"
