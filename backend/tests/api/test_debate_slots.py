"""The debate slots: up to debate_max_concurrent debates run at once; a maintenance operation takes all."""

import time
import uuid

import pytest

from backend.api import recovery
from backend.api.rate_limit import (
    DEBATE_SLOT_KEY,
    LEGACY_SLOT_KEY,
    DebateSlot,
    get_redis,
    slot_capacity,
    slot_holder,
    slot_holders,
)
from backend.config import settings


@pytest.fixture(autouse=True)
def _free_slots():
    get_redis().delete(DEBATE_SLOT_KEY, LEGACY_SLOT_KEY)
    yield
    get_redis().delete(DEBATE_SLOT_KEY, LEGACY_SLOT_KEY)


def test_as_many_debates_as_the_capacity_hold_a_slot_and_the_next_one_waits(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 3)
    slots = [DebateSlot() for _ in range(4)]

    assert [slot.acquire() for slot in slots] == [True, True, True, False]
    assert len(slot_holders()) == 3
    slots[0].release()
    assert slots[3].acquire()  # a freed slot goes to the one that was turned away
    assert len(slot_holders()) == 3


def test_the_capacity_is_never_below_one(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 0)
    assert slot_capacity() == 1
    assert DebateSlot().acquire() and not DebateSlot().acquire()


def test_a_holder_takes_its_investigation_id_and_only_it_can_release_its_slot(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 2)
    first, second = DebateSlot(), DebateSlot()
    assert first.acquire() and second.acquire()
    investigation = str(uuid.uuid4())

    first.bind(investigation)
    assert investigation in slot_holders() and len(slot_holders()) == 2
    DebateSlot().release()  # a holder that never acquired frees nothing
    assert len(slot_holders()) == 2
    first.release()
    assert investigation not in slot_holders() and len(slot_holders()) == 1


def test_holders_are_listed_longest_running_first(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 3)
    ids = [str(uuid.uuid4()) for _ in range(3)]
    for investigation in ids:
        slot = DebateSlot()
        assert slot.acquire()
        slot.bind(investigation)
        time.sleep(0.01)  # the order is the millisecond a slot was taken

    assert slot_holders() == ids
    assert slot_holder() == ids[0]


def test_a_maintenance_operation_needs_every_slot_free_and_blocks_debates_while_it_runs(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 3)
    debate = DebateSlot()
    assert debate.acquire()
    maintenance = DebateSlot(exclusive=True)

    assert not maintenance.acquire()  # a debate is running
    debate.release()
    assert maintenance.acquire()
    assert not DebateSlot().acquire()  # no debate starts while it holds the slots
    assert not DebateSlot(exclusive=True).acquire()  # and no second maintenance operation either
    maintenance.release()
    assert DebateSlot().acquire()


def test_a_hold_that_expired_frees_its_slot(monkeypatch):
    monkeypatch.setattr(settings, "debate_max_concurrent", 1)
    monkeypatch.setattr("backend.api.rate_limit.DEBATE_SLOT_TTL_SECONDS", 1)
    stuck = DebateSlot()
    assert stuck.acquire()
    assert not DebateSlot().acquire()

    time.sleep(1.3)
    assert slot_holders() == []  # a hold past its expiry is not listed
    assert DebateSlot().acquire()


def test_start_up_recovery_frees_every_slot_and_the_single_slot_key_of_earlier_versions(
    db_session, monkeypatch
):
    monkeypatch.setattr(settings, "debate_max_concurrent", 2)
    assert DebateSlot().acquire() and DebateSlot().acquire()
    get_redis().set(LEGACY_SLOT_KEY, "debate:pending:old-process", ex=60)

    marked, holder = recovery.recover_after_restart()

    assert marked == 0 and holder is not None
    assert slot_holders() == [] and get_redis().get(LEGACY_SLOT_KEY) is None
