# Install MicroPython

Get MicroPython running on your ESP32 board in one click.

## What happens

1. **Board detection** - The tool probes your board to identify the exact chip type (ESP32, ESP32-S3, ESP32-C3, etc.)
2. **Version selection** - Choose from the latest MicroPython releases fetched from GitHub
3. **Firmware download** - The correct `.bin` file is downloaded and cached locally
4. **Flash** - The firmware is written to your board automatically

## Before you start

- Plug your ESP32 board into a USB port
- No driver installation needed on most systems (CP210x / CH340 drivers may be required on some boards)

## Tip

If this is a **fresh board** or you're switching from another firmware, choose **"Yes"** when asked about erasing flash.
MicroPython recommends erasing before the first install for a clean start.
