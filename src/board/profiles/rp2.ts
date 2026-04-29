import { BoardProfile } from '../BoardProfile';

/**
 * Raspberry Pi RP2040 / RP2350 family (Pico, Pico W, Pico 2, Pico 2 W,
 * plus third-party boards built on the same chip).
 *
 * Flashing model differs from ESP fundamentally:
 *  - hold BOOTSEL while plugging in (or double-tap RESET on RP2350) to mount
 *    a USB mass-storage volume named "RPI-RP2";
 *  - copy a `.uf2` firmware file onto that volume;
 *  - the chip reboots automatically into the new firmware.
 * There is no espflash equivalent.
 *
 * Soft-reset / `machine.reset()` causes the native USB-CDC device to drop
 * for ~1-2 s and re-enumerate; reconnect logic must wait and rescan.
 */
export const rp2Profile: BoardProfile = {
  id: 'rp2',
  name: 'Raspberry Pi Pico',
  usbIds: [
    // RP2040 / RP2350 with MicroPython firmware (CDC ACM)
    { vid: '2e8a', pid: '0005', description: 'RP2040 MicroPython' },
    { vid: '2e8a', pid: '000a', description: 'RP2040 MicroPython (alt)' },
    { vid: '2e8a', pid: '1024', description: 'RP2040 CircuitPython' },

    // BOOTSEL mass-storage modes (rarely seen as a serial port, but useful
    // for VID/PID detection during firmware install flows)
    { vid: '2e8a', pid: '0003', description: 'RP2040 BOOTSEL (RPI-RP2)' },
    { vid: '2e8a', pid: '000f', description: 'RP2350 BOOTSEL (RP2350)' },
  ],
  platformLabels: {
    rp2: 'RP2040 / RP2350',
  },
  capabilities: {
    // Plain Pico / Pico 2 have no radio; Pico W and Pico 2 W do. Per-device
    // detection should override these flags after sys.platform / board name
    // is known.
    hasWiFi: false,
    hasBLE: false,
    hasNativeUsb: true,
    supportsRawPaste: true,
    flashTool: 'uf2',
    firmwareFormat: 'uf2',
    bootloaderEntry: 'manual-button',
    // RP2040 = Cortex-M0+. RP2350 ships in dual-core Cortex-M33 *and*
    // Hazard3 RISC-V variants; default to M0+ for the family and override
    // per-chip when detection produces 'rp2350' / 'rp2350-riscv'.
    cpuArch: 'arm-cortex-m0+',
  },
};
