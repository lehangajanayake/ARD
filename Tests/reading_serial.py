#!/usr/bin/env python3
"""Read Featherweight Ground Station telemetry over USB serial.

This expects the ground station or LoRa receiver to send one CSV packet per
line at 115200 baud. The first 11 fields match the ARD telemetry pipeline:

time,bmpTemp,imuTemp,pressure,altitude,accX,accY,accZ,angVelX,angVelY,angVelZ

RSSI, SNR, and packet_id may follow those fields. Debug text is displayed but
not parsed as telemetry.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from typing import Dict, Optional, TextIO, Union

import serial
from serial.tools import list_ports


CORE_FIELDS = (
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
)
OPTIONAL_FIELDS = ("rssi", "snr", "packet_id")


def available_ports() -> list[str]:
	"""Return hardware ports plus virtual ports created by socat."""
	hardware_ports = [port.device for port in list_ports.comports()]
	virtual_ports = [str(path) for path in Path("/tmp").glob("ttyV*")]
	return sorted(set(hardware_ports + virtual_ports))


def parse_telemetry(line: str) -> Optional[Dict[str, Union[float, int]]]:
	"""Parse one ARD CSV packet, returning None for non-telemetry text."""
	parts = [part.strip() for part in line.split(",")]
	if len(parts) < len(CORE_FIELDS):
		return None

	try:
		packet: Dict[str, Union[float, int]] = {
			field: float(parts[index])
			for index, field in enumerate(CORE_FIELDS)
		}
		for index, field in enumerate(OPTIONAL_FIELDS, start=len(CORE_FIELDS)):
			if index < len(parts) and parts[index]:
				packet[field] = int(float(parts[index])) if field == "packet_id" else float(parts[index])
	except ValueError:
		return None

	return packet


def open_log(path: Optional[str]) -> Optional[TextIO]:
	if not path:
		return None
	handle = Path(path).open("a", newline="", encoding="utf-8")
	if handle.tell() == 0:
		csv.writer(handle).writerow(("received_at", *CORE_FIELDS, *OPTIONAL_FIELDS, "raw"))
		handle.flush()
	return handle


def write_log(handle: TextIO, packet: Dict[str, Union[float, int]], raw: str) -> None:
	csv.writer(handle).writerow(
		[time.time(), *(packet.get(field, "") for field in CORE_FIELDS),
		 *(packet.get(field, "") for field in OPTIONAL_FIELDS), raw]
	)
	handle.flush()


def print_ports() -> None:
	ports = available_ports()
	if not ports:
		print("No serial ports found.")
		return
	print("Available serial ports:")
	for port in ports:
		print(f"  {port}")


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("-p", "--port", help="Serial device, for example /dev/cu.usbmodem...")
	parser.add_argument("-b", "--baud", type=int, default=115200, help="Baud rate (default: 115200)")
	parser.add_argument("--timeout", type=float, default=1.0, help="Read timeout in seconds")
	parser.add_argument("--list", action="store_true", help="List ports and exit")
	parser.add_argument("--log", metavar="FILE", help="Append parsed packets to a CSV file")
	parser.add_argument("--json", action="store_true", help="Print parsed packets as JSON")
	args = parser.parse_args()

	if args.list:
		print_ports()
		return 0

	port = args.port
	if not port:
		ports = available_ports()
		if len(ports) == 1:
			port = ports[0]
		else:
			print_ports()
			print("Select a port with --port.", file=sys.stderr)
			return 2

	log_handle = open_log(args.log)
	print(f"Opening {port} at {args.baud} baud. Press Ctrl-C to stop.")

	try:
		with serial.Serial(port, args.baud, timeout=args.timeout) as connection:
			while True:
				raw_bytes = connection.readline()
				if not raw_bytes:
					continue

				raw = raw_bytes.decode("utf-8", errors="replace").strip()
				packet = parse_telemetry(raw)
				if packet is None:
					print(f"[device] {raw}")
					continue

				if log_handle:
					write_log(log_handle, packet, raw)
				if args.json:
					print(json.dumps(packet), flush=True)
				else:
					print(",".join(f"{field}={packet[field]}" for field in packet), flush=True)
	except KeyboardInterrupt:
		print("\nStopped.")
	except serial.SerialException as error:
		print(f"Could not open/read {port}: {error}", file=sys.stderr)
		return 1
	finally:
		if log_handle:
			log_handle.close()

	return 0


if __name__ == "__main__":
	raise SystemExit(main())
