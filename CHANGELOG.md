# Changelog

## 0.2.2 - 2026-04-30

### Added

- Raspberry Pi Pico (RP2) board profile registered (not yet fully implemented)
- `BoardCapabilities` expanded to support upcoming non-ESP families
- `blinky.repl.flushDelayMs` setting to tune REPL output flush timing

### Fixed

- Notebook controller no longer leaks the active cancellation token source when cells overlap
- AutoSync file watcher subscriptions are now properly disposed when auto-sync is disabled
- `espflash` subprocess now has a 5-minute timeout and surfaces a clear error when the bundled binary cannot be made executable
- Firmware download URLs are now validated against a strict allowlist before being constructed
- REPL disconnect / notebook "not connected" messages now reference the Command Palette command name instead of a hardcoded keybinding

## 0.2.1 - 2026-04-07

### Fixed

- F5 (Run File) no longer times out on scripts that take more than 5 seconds — execution now uses streaming output with no timeout
- Script output (`print()`) streams to the Output Channel in real time instead of appearing all at once after completion
- Pressing the board's RST button while a script is running now cleanly stops execution instead of spilling ROM boot output into the Output Channel
- Shift+F5 (Stop Script) now reliably cancels streaming execution even when the board is unresponsive

## 0.2.0 - 2026-04-06

### Added

- ESP8266 support (ESP-01, NodeMCU, Wemos D1 Mini) — REPL, file management, and script execution. Flashing is not supported due to ESP8266 bootloader limitations; use `esptool.py` to install MicroPython first
- Auto-reset after flashing — board reboots into MicroPython immediately, no manual power-cycle needed
- "Flash Firmware" command now auto-detects the chip and uses the correct flash address; prompts user for unknown chips

### Fixed

- `Cmd+Shift+P` shown on Windows/Linux in REPL disconnect message and notebook error — now correctly shows `Ctrl+Shift+P`
- Raw espflash error output no longer leaks into user-facing board detection error messages

## 0.1.3 - 2026-04-05

### Fixed

- Linux builds now compiled against glibc 2.35 (Ubuntu 22.04) for compatibility with Debian 12, Fedora 38+, RHEL 9, and Ubuntu 22.04+

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
