"""The rule that decides when the live feed wakes the investigators (checklist RT2).

It looks at a sliding window of the rows that just arrived from one source and returns a score. It never
reads a label: the inputs are a row's own fields (raw_fields) and the dataset-wide mean and spread of the
same field. SKILL-architecture.md Section 4 calls this layer the trigger; the investigators still decide what
the rows mean.

  network (CICIDS2017 flows, window of 30)  the spread (standard deviation) of log10(1 + Flow Packets/s).
      A window of near-identical flows (a flood, a scan, repeated login attempts, a beacon) has a small
      spread; ordinary traffic does not. Flag when the spread is at most NETWORK_MAX_SPREAD.
  logon / device / file (CERT r4.2, window of 20)  the mean of one field per row: off_hours (1 or 0),
      connect_count, file_access_count. Flag when the window mean is Z_FLAG standard errors above the
      dataset mean: z = (window mean - dataset mean) / (dataset std / sqrt(rows in window)).

suspicion is the same 0..1 scale for every group, with the flag at 0.5, so one gauge can show them all.
"""

import math
import statistics
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

NETWORK = "network"
LOGON = "logon"
DEVICE = "device"
FILE = "file"
GROUPS: tuple[str, ...] = (NETWORK, LOGON, DEVICE, FILE)

GROUP_OF_SOURCE: Mapping[str, str] = {
    "cicids2017": NETWORK,
    "cert_r4.2_logon": LOGON,
    "cert_r4.2_device": DEVICE,
    "cert_r4.2_file": FILE,
}
WINDOW_SIZE: Mapping[str, int] = {NETWORK: 30, LOGON: 20, DEVICE: 20, FILE: 20}
FEATURE_NAME: Mapping[str, str] = {
    NETWORK: "log10(1 + Flow Packets/s)",
    LOGON: "off_hours",
    DEVICE: "connect_count",
    FILE: "file_access_count",
}

Z_FLAG = 4.0  # standard errors above the dataset mean
NETWORK_MAX_SPREAD = 0.5  # in log10 units: flows within about a factor of 3 of each other
MIN_NETWORK_FLOWS = 10  # a spread over fewer finite values is not meaningful


@dataclass(frozen=True)
class Baseline:
    """Dataset-wide mean and standard deviation of one field, over every row of its source."""

    mean: float
    std: float
    n: int


@dataclass(frozen=True)
class WindowScore:
    group: str
    rows: int  # rows in the window that carried a usable value
    value: float | None  # network: the spread; others: the window mean
    threshold: float | None  # the value at which the window is flagged
    z: float | None  # standard errors above the dataset mean (None for network)
    suspicion: float  # 0..1, flag at 0.5
    flagged: bool
    rule: str  # plain words with the numbers, shown as the trigger reason


def row_feature(group: str, raw_fields: Mapping[str, Any]) -> float | None:
    """The single number a row contributes to its window, or None when the row has no usable value."""
    if group == NETWORK:
        packets_per_second = _number(raw_fields.get("Flow Packets/s"))
        if packets_per_second is None or packets_per_second < 0:
            return None
        return math.log10(1.0 + packets_per_second)
    if group == LOGON:
        flag = raw_fields.get("off_hours")
        return None if flag is None else 1.0 if flag is True or str(flag).lower() == "true" else 0.0
    return _number(raw_fields.get(FEATURE_NAME[group]))


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def score_window(group: str, features: Sequence[float | None], baseline: Baseline | None) -> WindowScore:
    """Scores one window. features are the row_feature values of the rows in it, oldest first."""
    values = [value for value in features if value is not None]
    if group == NETWORK:
        return _score_network(values)
    return _score_mean(group, values, baseline)


def _score_network(values: list[float]) -> WindowScore:
    if len(values) < MIN_NETWORK_FLOWS:
        return WindowScore(
            NETWORK, len(values), None, NETWORK_MAX_SPREAD, None, 0.0, False, "too few flows to compare"
        )
    spread = statistics.pstdev(values)
    flagged = spread <= NETWORK_MAX_SPREAD
    return WindowScore(
        group=NETWORK,
        rows=len(values),
        value=spread,
        threshold=NETWORK_MAX_SPREAD,
        z=None,
        suspicion=_clamp01(1.0 - spread / (2.0 * NETWORK_MAX_SPREAD)),
        flagged=flagged,
        rule=(
            f"network window: {len(values)} flows with a packet-rate spread of {spread:.2f} "
            f"(log10 units; flagged at {NETWORK_MAX_SPREAD:.2f} or less)"
        ),
    )


def _score_mean(group: str, values: list[float], baseline: Baseline | None) -> WindowScore:
    name = FEATURE_NAME[group]
    if not values or baseline is None or baseline.std <= 0.0:
        return WindowScore(group, len(values), None, None, None, 0.0, False, f"no baseline for {name}")
    mean = statistics.fmean(values)
    standard_error = baseline.std / math.sqrt(len(values))
    z = (mean - baseline.mean) / standard_error
    threshold = baseline.mean + Z_FLAG * standard_error
    return WindowScore(
        group=group,
        rows=len(values),
        value=mean,
        threshold=threshold,
        z=z,
        suspicion=_clamp01(z / (2.0 * Z_FLAG)),
        flagged=z >= Z_FLAG,
        rule=(
            f"{group} window: mean {name} {mean:.2f} over {len(values)} rows, {z:.1f} standard errors above "
            f"the dataset mean {baseline.mean:.2f} (flagged at {Z_FLAG:.0f} or more)"
        ),
    )


def rank_rows(group: str, rows: Sequence[Any], features: Sequence[float | None]) -> list[Any]:
    """The rows of a flagged window, the ones that carry the signal first, so the investigators read those.
    network: the flows closest to the window's median packet rate (the repeated pattern); other groups: the
    highest field value. rows and features are parallel; a row without a value goes last."""
    pairs = list(zip(rows, features, strict=True))
    present = [feature for feature in features if feature is not None]
    centre = statistics.median(present) if group == NETWORK and present else None

    def order(pair: tuple[Any, float | None]) -> tuple[bool, float]:
        feature = pair[1]
        if feature is None:
            return True, 0.0
        return False, abs(feature - centre) if centre is not None else -feature

    return [row for row, _ in sorted(pairs, key=order)]
