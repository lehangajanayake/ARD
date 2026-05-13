import csv
from pathlib import Path
from typing import Dict, Any


class TelemetryRecorder:
    """
    Appends clean pipeline output to a CSV file for post-flight analysis.
    """

    def __init__(self, path: str = "flight_log.csv"):
        self.path = Path(path)
        self.fieldnames = None

    def write(self, row: Dict[str, Any]) -> None:
        # Convert warnings list to a readable string for CSV.
        row = dict(row)
        if isinstance(row.get("warnings"), list):
            row["warnings"] = "|".join(row["warnings"])

        if self.fieldnames is None:
            self.fieldnames = list(row.keys())

        new_file = not self.path.exists() or self.path.stat().st_size == 0
        with self.path.open("a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=self.fieldnames, extrasaction="ignore")
            if new_file:
                writer.writeheader()
            writer.writerow(row)
