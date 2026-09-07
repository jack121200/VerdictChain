import socket
import struct

from backend.pipeline.normalization import (
    _decimal_to_dotted_ip,
    normalize_cert_device_row,
    normalize_cert_file_row,
    normalize_cert_logon_row,
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


CERT_LOGON_ROW = {
    "user": "AAM0658",
    "day": "2010-01-02",
    "logon_count": 3,
    "logoff_count": 3,
    "distinct_pcs": 1,
    "primary_pc": "PC-9923",
    "off_hours": True,
    "ground_truth_label": "insider_scenario_1",
    "row_ids": "{e1},{e2}",
}


def test_normalize_cert_logon_row_shape():
    out = normalize_cert_logon_row(CERT_LOGON_ROW)
    assert out["source"] == "cert_r4.2_logon"
    assert out["event_type"] == "logon"
    assert out["user_id"] == "AAM0658"
    assert out["host_id"] == "PC-9923"
    assert out["ground_truth_label"] == "insider_scenario_1"
    assert out["timestamp"].isoformat() == "2010-01-02T00:00:00+00:00"


def test_normalize_cert_logon_row_never_leaks_label_into_raw_fields():
    out = normalize_cert_logon_row(CERT_LOGON_ROW)
    assert "ground_truth_label" not in out["raw_fields"]
    assert "user" not in out["raw_fields"]
    assert out["raw_fields"]["logon_count"] == 3
    assert out["raw_fields"]["off_hours"] is True


def test_normalize_cert_device_and_file_rows_never_leak_label():
    device_row = {
        "user": "U1",
        "day": "2010-01-02",
        "connect_count": 2,
        "primary_pc": "PC-1",
        "ground_truth_label": "insider_scenario_2",
        "distinct_pcs_with_device_activity": 1,
        "row_ids": "",
    }
    file_row = {
        "user": "U1",
        "day": "2010-01-02",
        "file_access_count": 5,
        "primary_pc": "PC-1",
        "ground_truth_label": "benign",
        "user_department": "Finance",
        "distinct_filenames": 5,
        "row_ids": "",
    }

    device_out = normalize_cert_device_row(device_row)
    file_out = normalize_cert_file_row(file_row)

    assert "ground_truth_label" not in device_out["raw_fields"]
    assert "ground_truth_label" not in file_out["raw_fields"]
    assert device_out["event_type"] == "device_event"
    assert file_out["event_type"] == "file_access"
    assert file_out["raw_fields"]["user_department"] == "Finance"
