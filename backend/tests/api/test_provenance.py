"""CT10: investigations made by the offline stub are marked, and accuracy measured on them is kept apart."""

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.provenance import classify_source, source_of
from backend.tests.fixtures.read_seed import add_investigation, add_transcript, bearer_for

client = TestClient(app)


def test_every_provider_a_stub_label_means_stub_some_means_mixed_none_means_model():
    assert source_of(["stub-openai", "stub-openai"]) == "stub"
    assert source_of(["stub-openai", "openai"]) == "mixed"
    assert source_of(["openai", "openai"]) == "model"
    assert source_of([]) == "model"  # no transcript yet: nothing marks it as stub
    assert source_of([None, "stub-openai"]) == "stub"  # a row without a provider is ignored
    assert classify_source(total=3, stub=0) == "model"


def _stub_run(db_session, *, label: str, verdict: str, providers=("stub-openai", "stub-openai")):
    inv = add_investigation(db_session, scenario_label=label, verdict_class=verdict)
    for index, provider in enumerate(providers):
        add_transcript(
            db_session,
            inv.investigation_id,
            round_no=1,
            agent_id=("network_traffic", "access_log", "endpoint_behavior")[index],
            theory="t",
            provider=provider,
        )
    return inv


def test_the_list_and_the_detail_say_where_the_answers_came_from(db_session):
    stub = _stub_run(db_session, label="DDoS", verdict="ddos")
    real = _stub_run(db_session, label="DDoS", verdict="ddos", providers=("openai", "openai"))
    mixed = _stub_run(db_session, label="DDoS", verdict="ddos", providers=("stub-openai", "openai"))
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    listed = {
        row["investigation_id"]: row["data_source"]
        for row in client.get("/investigations", headers=headers).json()
    }

    assert listed == {
        str(stub.investigation_id): "stub",
        str(real.investigation_id): "model",
        str(mixed.investigation_id): "mixed",
    }
    detail = client.get(f"/investigations/{stub.investigation_id}", headers=headers).json()
    assert detail["data_source"] == "stub"


def test_default_accuracy_leaves_the_stub_runs_out_and_says_so(db_session):
    _stub_run(db_session, label="DDoS", verdict="ddos")  # correct, but made by the stub
    _stub_run(db_session, label="DDoS", verdict="ddos")
    real_right = _stub_run(db_session, label="DDoS", verdict="ddos", providers=("openai", "openai"))
    real_wrong = _stub_run(db_session, label="DDoS", verdict="port_scan", providers=("openai", "openai"))
    db_session.commit()
    del real_right, real_wrong

    body = client.get("/evaluation", headers=bearer_for("forensic_analyst")).json()

    assert body["source"] == "model" and body["scored"]["value"] == 2
    assert body["accuracy"]["value"] == pytest.approx(
        0.5
    )  # one right and one wrong model run; the stub's two do not count
    assert body["by_source"]["stub"]["scored"]["value"] == 2
    assert body["by_source"]["stub"]["accuracy"]["value"] == 1.0
    assert body["by_source"]["model"]["scored"]["value"] == 2
    assert body["by_source"]["mixed"]["scored"]["value"] == 0
    assert (
        body["by_source"]["mixed"]["accuracy"]["value"] is None
        and body["by_source"]["mixed"]["accuracy"]["reason"]
    )
    assert "offline stub only" in body["by_source"]["stub"]["accuracy"]["definition"]


def test_with_only_stub_runs_the_headline_is_a_dash_with_its_reason_not_the_stub_accuracy(db_session):
    _stub_run(db_session, label="DDoS", verdict="ddos")
    db_session.commit()

    body = client.get("/evaluation", headers=bearer_for("forensic_analyst")).json()

    assert body["scored"]["value"] == 0
    assert body["accuracy"]["value"] is None
    assert body["accuracy"]["reason"] == (
        "no model runs scored yet; 1 scored run(s) from other sources are not counted here"
    )
    assert body["by_source"]["stub"]["accuracy"]["value"] == 1.0  # visible, and labelled as the stub's


def test_the_source_can_be_asked_for_explicitly(db_session):
    _stub_run(db_session, label="DDoS", verdict="ddos")
    _stub_run(db_session, label="DDoS", verdict="port_scan", providers=("openai", "openai"))
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    stub = client.get("/evaluation?source=stub", headers=headers).json()
    everything = client.get("/evaluation?source=all", headers=headers).json()

    assert stub["scored"]["value"] == 1 and stub["accuracy"]["value"] == 1.0
    assert everything["scored"]["value"] == 2 and everything["accuracy"]["value"] == pytest.approx(0.5)
    assert client.get("/evaluation?source=guess", headers=headers).status_code == 422
