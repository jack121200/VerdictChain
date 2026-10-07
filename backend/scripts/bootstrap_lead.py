"""Creates or promotes the first SecOps Lead (plan section 3.6).

Run from the repo root:  python -m backend.scripts.bootstrap_lead

Reads BOOTSTRAP_LEAD_USERNAME and BOOTSTRAP_LEAD_PASSWORD from .env. If the password is unset and the
user has to be created, it is read with getpass. The password is never printed. Idempotent: running it
again changes nothing and writes no audit entry. Audit actor is "system".
"""

import getpass
import sys

from sqlalchemy import select

from backend.api.auth import hash_password
from backend.config import settings
from backend.db.audit import append_entry
from backend.db.models import Analyst
from backend.db.session import SessionLocal

LEAD = "secops_lead"
ACTOR = "system"
_MIN_PASSWORD, _MAX_PASSWORD = 8, 128  # the same policy as RegisterRequest


def bootstrap_lead(username: str, password: str | None = None) -> str:
    """Returns "created", "promoted" or "unchanged". `password` is used only when the user is created."""
    with SessionLocal() as session:
        # Same lock order as the users route: all leads first, then the target.
        session.execute(
            select(Analyst.analyst_id)
            .where(Analyst.role == LEAD)
            .order_by(Analyst.analyst_id)
            .with_for_update()
        ).all()
        analyst = session.execute(
            select(Analyst).where(Analyst.username == username).with_for_update()
        ).scalar_one_or_none()

        if analyst is None:
            if password is None:
                password = getpass.getpass("Password for the new SecOps Lead: ")
            if not _MIN_PASSWORD <= len(password) <= _MAX_PASSWORD:
                raise ValueError(f"password must be {_MIN_PASSWORD} to {_MAX_PASSWORD} characters")
            session.add(Analyst(username=username, password_hash=hash_password(password), role=LEAD))
            append_entry(session, actor=ACTOR, action="register", detail={"username": username, "role": LEAD})
            session.commit()
            return "created"

        if analyst.role == LEAD:
            return "unchanged"

        before = analyst.role
        analyst.role = LEAD
        append_entry(
            session,
            actor=ACTOR,
            action="role_changed",
            detail={"username": username, "before": before, "after": LEAD},
        )
        session.commit()
        return "promoted"


def main() -> int:
    username = settings.bootstrap_lead_username.strip()
    if not username:
        print("BOOTSTRAP_LEAD_USERNAME is not set in .env", file=sys.stderr)
        return 2
    try:
        outcome = bootstrap_lead(username, settings.bootstrap_lead_password or None)
    except ValueError as exc:
        print(f"bootstrap failed: {exc}", file=sys.stderr)
        return 2
    messages = {
        "created": f"created SecOps Lead {username!r}",
        "promoted": f"promoted {username!r} to secops_lead",
        "unchanged": f"{username!r} is already a secops_lead; nothing changed",
    }
    print(messages[outcome])
    return 0


if __name__ == "__main__":
    sys.exit(main())
