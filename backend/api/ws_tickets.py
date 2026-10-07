"""Single-use WebSocket tickets (plan section 3.5). The browser cannot send an Authorization header on a
WebSocket, and a JWT in the URL would land in logs. So the client trades its token for a short-lived
ticket with POST /auth/ws-ticket, and the socket consumes the ticket once.
"""

import secrets

from backend.api.rate_limit import get_redis

TICKET_TTL_SECONDS = 30


def _key(ticket: str) -> str:
    return f"verdictchain:wsticket:{ticket}"


def issue_ticket(username: str) -> str:
    ticket = secrets.token_urlsafe(32)
    get_redis().set(_key(ticket), username, ex=TICKET_TTL_SECONDS)
    return ticket


def consume_ticket(ticket: str | None) -> str | None:
    """Returns the username the ticket was issued to, and deletes it (GETDEL). None if the ticket is
    missing, expired, already used, or unknown.
    """
    if not ticket:
        return None
    return get_redis().getdel(_key(ticket))
