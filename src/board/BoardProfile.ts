/**
 * Board profile - describes a family of MicroPython boards.
 * The core plugin is board-agnostic; profiles provide the board-specific
 * knowledge (USB identifiers, platform labels, etc.).
 */
export interface BoardProfile {
  /** Profile identifier, e.g. 'esp32', 'rp2040', 'stm32' */
  id: string;
  /** Human-readable name, e.g. 'ESP32' */
  name: string;
  /** Known USB VID:PID combos for auto-detection */
  usbIds: UsbDeviceId[];
  /** Map of sys.platform → human-readable chip name */
  platformLabels: Record<string, string>;
  /**
   * Optional capability flags consumed by the UI to gate features
   * (network panels, BLE actions, partition pickers, etc.).
   * Boards in the same family may differ — these describe the family
   * default; per-device detection should override when available.
   */
  capabilities?: BoardCapabilities;
}

export interface BoardCapabilities {
  /** Has a Wi-Fi radio. */
  hasWiFi?: boolean;
  /** Has a Bluetooth/BLE radio. */
  hasBLE?: boolean;
  /**
   * The chip exposes its serial port via native USB-CDC (rather than via
   * an external USB-UART bridge). When true, soft-reset / `machine.reset()`
   * will drop the USB device for ~1-2s before re-enumerating; reconnect
   * logic must wait and rescan rather than treating the disconnect as
   * a fatal error.
   */
  hasNativeUsb?: boolean;
  /**
   * MicroPython's "raw-paste" mode is supported (added in 1.14). When
   * false, RawRepl falls back to plain raw-mode exec for code uploads.
   */
  supportsRawPaste?: boolean;
  /** Flashing back-end used by this family. */
  flashTool?: 'espflash' | 'uf2';
  /** File format the firmware ships in. */
  firmwareFormat?: 'bin' | 'uf2';
  /**
   * How the user (or the tool) puts the chip into bootloader / DFU mode:
   *  - 'auto-rts'         : toggled automatically over RTS/DTR (ESP).
   *  - 'uf2-double-tap'   : double-tap RESET to mount UF2 volume (RP2350,
   *                         many SAMD boards).
   *  - 'manual-button'    : user must hold BOOT/BOOTSEL while plugging in.
   */
  bootloaderEntry?: 'auto-rts' | 'uf2-double-tap' | 'manual-button';
  /** Coarse CPU architecture, useful for status display & stub selection. */
  cpuArch?: 'xtensa' | 'arm-cortex-m0+' | 'arm-cortex-m33' | 'riscv';
  /** Typical flash size in MiB. Use undefined when it varies widely. */
  flashSizeMb?: number;
}

export interface UsbDeviceId {
  /** Vendor ID (lowercase hex, no 0x prefix) */
  vid: string;
  /** Product ID (lowercase hex, no 0x prefix) */
  pid: string;
  /** Human-readable chip/adapter description */
  description: string;
}

/**
 * Match a VID/PID against all registered profiles.
 * Returns the first matching profile + USB entry, or undefined.
 */
export function matchUsbId(
  profiles: BoardProfile[],
  vid: string,
  pid: string,
): { profile: BoardProfile; usbId: UsbDeviceId } | undefined {
  for (const profile of profiles) {
    const usbId = profile.usbIds.find((u) => u.vid === vid && u.pid === pid);
    if (usbId) {
      return { profile, usbId };
    }
  }
  return undefined;
}

/**
 * Look up a human-readable label for a platform string across all profiles.
 * Falls back to uppercased platform name if not found.
 */
export function platformLabel(profiles: BoardProfile[], platform: string): string {
  for (const profile of profiles) {
    const label = profile.platformLabels[platform];
    if (label) return label;
  }
  return platform.toUpperCase();
}
