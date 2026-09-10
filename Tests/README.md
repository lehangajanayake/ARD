# Serial reader script

`reading_serial.py` reads ARD telemetry packets from a USB/serial device.

## Prerequisite

Install the Python dependency used by the script:

```bash
pip install -r backend/requirements.txt
```

## Commands

List detected serial ports:

```bash
python Tests/reading_serial.py --list
```

Read from a specific serial port:

```bash
python Tests/reading_serial.py --port /dev/ttyUSB0
```

Read from a specific port and baud rate:

```bash
python Tests/reading_serial.py --port /dev/ttyUSB0 --baud 115200
```

Print packets as JSON:

```bash
python Tests/reading_serial.py --port /dev/ttyUSB0 --json
```

Append parsed packets to a CSV log file:

```bash
python Tests/reading_serial.py --port /dev/ttyUSB0 --log serial_log.csv
```
