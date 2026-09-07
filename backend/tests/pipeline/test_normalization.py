import socket
import struct

import pytest

from backend.pipeline.normalization import (
    _decimal_to_dotted_ip,
    normalize_cert_row,
    normalize_network_row,
)

SAMPLE_ROW = {
    "Timestamp": "2017-07-07T00:59:58+00:00",
    "Source IP": 3232238130,
    "Destination Port": 445,
    "Flow Duration": 112740690,
    "Total Fwd Packets": 32,
    "Label": "DDoS",
    "Source File": "friday.csv",
}


def test_decimal_to_dotted_ip_matches_stdlib():
    n = 3232238130
    expected = socket.inet_ntoa(struct.pack("!I", n))
    assert _decimal_to_dotted_ip(n) == expected


def test_normalize_network_row_shape():
    out = normalize_network_row(SAMPLE_ROW)
    assert out["source"] == "cicids2017"
    assert out["source_file"] == "friday.csv"
    assert out["event_type"] == "network_flow"
    assert out["user_id"] is None
    assert out["host_id"] == socket.inet_ntoa(struct.pack("!I", 3232238130))
    assert out["ground_truth_label"] == "DDoS"
    assert out["timestamp"].isoformat() == "2017-07-07T00:59:58+00:00"


def test_normalize_network_row_never_leaks_label_into_raw_fields():
    out = normalize_network_row(SAMPLE_ROW)
    assert "Label" not in out["raw_fields"]
    assert "Timestamp" not in out["raw_fields"]
    assert "Source File" not in out["raw_fields"]
    assert out["raw_fields"]["Destination Port"] == 445
    assert out["raw_fields"]["Flow Duration"] == 112740690


def test_normalize_cert_row_not_implemented_yet():
    with pytest.raises(NotImplementedError):
        normalize_cert_row({})
