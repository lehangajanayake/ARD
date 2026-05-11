from dataclasses import dataclass, asdict, field
from typing import Optional, List, Dict, Any

DATA_COLUMNS = [
    "time",
    "bmpTemp",
    "imuTemp",
    "pressure",
    "altitude",
    "accX",
    "accY",
    "accZ",
    "angVelX",
    "angVelY",
    "angVelZ",
]

OPTIONAL_COLUMNS = ["rssi", "snr", "packet_id"]


@dataclass
class TelemetryFrame:
    time: float
    bmpTemp: float
    imuTemp: float
    pressure: float
    altitude: float
    accX: float
    accY: float
    accZ: float
    angVelX: float
    angVelY: float
    angVelZ: float

    # Optional radio/link fields
    rssi: Optional[float] = None
    snr: Optional[float] = None
    packet_id: Optional[int] = None

    # Added by backend pipeline
    received_at: Optional[float] = None
    quality_status: str = "OK"
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
