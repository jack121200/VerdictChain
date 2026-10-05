"""Decides whether the test suite may run against a database URL.

The suite TRUNCATEs tables, so it must never point at the dev database. The check only
reports the database name, never the URL, because the URL carries a password.
"""

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

DEV_DATABASE_NAME = "verdictchain"


def refusal_reason(url: str) -> str | None:
    """Return why the suite must not use `url`, or None if it is safe to use."""
    if not url:
        return "no database URL is configured"
    try:
        name = make_url(url).database or ""
    except ArgumentError:
        return "the database URL is malformed"
    if name.lower() == DEV_DATABASE_NAME:
        return f"the database {name!r} is the dev database, and the tests TRUNCATE their tables"
    if "test" not in name.lower():
        return f"the database {name!r} does not look like a test database (its name must contain 'test')"
    return None
