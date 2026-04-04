# Changelog

## 0.1.2 - 2026-04-05

### Fixed

- Extension commands were silently unavailable on all platforms due to `serialport` native module not being included in the published VSIX

## 0.1.1 - 2026-04-05

### Fixed

- ESP32 (the original one) firmware now flashes at the correct address (0x1000), fixing `flash read err, 1000` boot failures after install - which were invisible mostly - causing the infinite wait on REPL and the prompt to interrupt the running script.

## 0.1.0 - 2026-04-04

### Added

- Interactive REPL terminal with syntax coloring, tab autocomplete, and persistent history
- Run `.py` files on the board with F5 or run selected code with Shift+Enter
- Board file manager — browse, upload, download, rename, and delete files
- One-click project sync with smart change detection
- Auto-sync watches for local file saves
- Firmware flashing for ESP32 family
- One-click MicroPython install — detects board, downloads firmware, and flashes
- REPL notebooks (`.mpnb`) — Jupyter-style interactive sessions on the board
- Project templates — Blink LED, WiFi Scanner, Web Server, Temperature Sensor
- MicroPython type stubs for Pylance autocomplete
- Getting Started walkthrough guide
